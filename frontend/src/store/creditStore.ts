import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

export type RedeemCodeStatus = "unused" | "used" | "disabled" | "expired";
export type CreditTransactionType = "redeem_code" | "generation_cost" | "generation_refund" | "admin_adjust";

export interface CreditPackage {
  id: string;
  name: string;
  description: string;
  credits: number;
  bonusCredits: number;
  price: number;
  discountText: string;
  purchaseUrl: string;
  enabled: boolean;
  tags: string[];
  sortOrder: number;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface RedeemCode {
  id: string;
  code: string;
  packageId: string;
  batchName: string;
  status: RedeemCodeStatus;
  expiresAt?: number;
  usedByUserId?: string;
  usedAt?: number;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreditAccount {
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  updatedAt: number;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  type: CreditTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  redeemCodeId?: string;
  packageId?: string;
  generationTaskId?: string;
  note: string;
  createdAt: number;
}

interface CreditState {
  packages: CreditPackage[];
  redeemCodes: RedeemCode[];
  accounts: CreditAccount[];
  transactions: CreditTransaction[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  addPackage: (input: PackageInput) => string;
  updatePackage: (id: string, input: PackageInput) => void;
  removePackage: (id: string) => { ok: true } | { ok: false; message: string };
  generateRedeemCodes: (input: GenerateRedeemCodesInput) => RedeemCode[];
  disableRedeemCode: (id: string) => void;
  removeRedeemCode: (id: string) => { ok: true } | { ok: false; message: string };
  redeemCode: (userId: string, code: string) => { ok: true; amount: number; packageName: string } | { ok: false; message: string };
  spendCredits: (input: SpendCreditsInput) => { ok: true } | { ok: false; message: string };
  refundCredits: (input: RefundCreditsInput) => void;
  adjustCredits: (userId: string, amount: number, note: string) => void;
}

export interface PackageInput {
  name: string;
  description: string;
  credits: number;
  bonusCredits: number;
  price: number;
  discountText: string;
  purchaseUrl: string;
  enabled: boolean;
  tags: string[];
  sortOrder: number;
  note: string;
}

export interface GenerateRedeemCodesInput {
  packageId: string;
  quantity: number;
  batchName: string;
  expiresAt?: number;
  note: string;
}

export interface SpendCreditsInput {
  userId: string;
  amount: number;
  generationTaskId: string;
  note: string;
}

export interface RefundCreditsInput {
  userId: string;
  amount: number;
  generationTaskId: string;
  note: string;
}

type PersistedCreditState = Pick<CreditState, "packages" | "redeemCodes" | "accounts" | "transactions">;

export const CURRENT_USER_ID = "local-user";

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const blocks = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
  );
  return blocks.join("-");
}

function normalizeAmount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 10000) / 10000) : 0;
}

function normalizePackageInput(input: PackageInput): PackageInput {
  return {
    ...input,
    name: input.name.trim() || "未命名套餐",
    description: input.description.trim(),
    credits: normalizeAmount(input.credits),
    bonusCredits: normalizeAmount(input.bonusCredits),
    price: Number.isFinite(input.price) ? Math.max(0, input.price) : 0,
    discountText: input.discountText.trim(),
    purchaseUrl: input.purchaseUrl.trim(),
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    sortOrder: Number.isFinite(input.sortOrder) ? Math.floor(input.sortOrder) : 0,
    note: input.note.trim(),
  };
}

function getPackageTotal(pkg: CreditPackage) {
  return pkg.credits + pkg.bonusCredits;
}

function getCodeStatus(code: RedeemCode, now = Date.now()): RedeemCodeStatus {
  if (code.status === "unused" && code.expiresAt && code.expiresAt < now) return "expired";
  return code.status;
}

function getOrCreateAccount(accounts: CreditAccount[], userId: string, now: number) {
  const existing = accounts.find((account) => account.userId === userId);
  if (existing) return existing;
  return { userId, balance: 0, totalEarned: 0, totalSpent: 0, updatedAt: now };
}

function writeAccount(accounts: CreditAccount[], account: CreditAccount) {
  return accounts.some((item) => item.userId === account.userId)
    ? accounts.map((item) => (item.userId === account.userId ? account : item))
    : [...accounts, account];
}

function makeTransaction(input: Omit<CreditTransaction, "id" | "createdAt">, now: number): CreditTransaction {
  return {
    id: createId("txn"),
    createdAt: now,
    ...input,
  };
}

function createDefaultState(): PersistedCreditState {
  const now = Date.now();
  return {
    packages: [
      {
        id: "pkg-starter",
        name: "基础积分包",
        description: "适合轻量体验图片生成。",
        credits: 1000,
        bonusCredits: 0,
        price: 9.9,
        discountText: "限时优惠",
        purchaseUrl: "",
        enabled: true,
        tags: ["基础"],
        sortOrder: 10,
        note: "默认示例套餐，可在后台修改或删除。",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "pkg-pro",
        name: "专业积分包",
        description: "更适合高频图片与视频生成。",
        credits: 3000,
        bonusCredits: 600,
        price: 29.9,
        discountText: "买 3000 送 600",
        purchaseUrl: "",
        enabled: true,
        tags: ["推荐"],
        sortOrder: 20,
        note: "默认示例套餐，可在后台修改或删除。",
        createdAt: now,
        updatedAt: now,
      },
    ],
    redeemCodes: [],
    accounts: [{ userId: CURRENT_USER_ID, balance: 0, totalEarned: 0, totalSpent: 0, updatedAt: now }],
    transactions: [],
  };
}

export const useCreditStore = create<CreditState>()(
  persist(
    (set) => ({
      ...createDefaultState(),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      addPackage: (input) => {
        const now = Date.now();
        const normalized = normalizePackageInput(input);
        const id = createId("pkg");
        set((state) => ({
          packages: [
            {
              id,
              ...normalized,
              createdAt: now,
              updatedAt: now,
            },
            ...state.packages,
          ],
        }));
        return id;
      },
      updatePackage: (id, input) => {
        const normalized = normalizePackageInput(input);
        set((state) => ({
          packages: state.packages.map((pkg) => (pkg.id === id ? { ...pkg, ...normalized, updatedAt: Date.now() } : pkg)),
        }));
      },
      removePackage: (id) => {
        let result: { ok: true } | { ok: false; message: string } = { ok: true };
        set((state) => {
          if (state.redeemCodes.some((code) => code.packageId === id)) {
            result = { ok: false, message: "该套餐已关联兑换码，不能删除。" };
            return state;
          }
          return { packages: state.packages.filter((pkg) => pkg.id !== id) };
        });
        return result;
      },
      generateRedeemCodes: (input) => {
        const now = Date.now();
        const quantity = Math.min(Math.max(1, Math.floor(input.quantity)), 1000);
        let created: RedeemCode[] = [];
        set((state) => {
          const existingCodes = new Set(state.redeemCodes.map((item) => item.code));
          const nextCodes: RedeemCode[] = [];
          while (nextCodes.length < quantity) {
            const code = createCode();
            if (existingCodes.has(code)) continue;
            existingCodes.add(code);
            nextCodes.push({
              id: createId("code"),
              code,
              packageId: input.packageId,
              batchName: input.batchName.trim(),
              status: "unused",
              expiresAt: input.expiresAt,
              note: input.note.trim(),
              createdAt: now,
              updatedAt: now,
            });
          }
          created = nextCodes;
          return { redeemCodes: [...nextCodes, ...state.redeemCodes] };
        });
        return created;
      },
      disableRedeemCode: (id) => {
        set((state) => ({
          redeemCodes: state.redeemCodes.map((code) =>
            code.id === id && code.status === "unused" ? { ...code, status: "disabled", updatedAt: Date.now() } : code
          ),
        }));
      },
      removeRedeemCode: (id) => {
        let result: { ok: true } | { ok: false; message: string } = { ok: true };
        set((state) => {
          const code = state.redeemCodes.find((item) => item.id === id);
          if (code?.status === "used") {
            result = { ok: false, message: "已使用兑换码不能删除。" };
            return state;
          }
          return { redeemCodes: state.redeemCodes.filter((item) => item.id !== id) };
        });
        return result;
      },
      redeemCode: (userId, rawCode) => {
        const now = Date.now();
        const normalizedCode = rawCode.trim().toUpperCase();
        let result: { ok: true; amount: number; packageName: string } | { ok: false; message: string } = {
          ok: false,
          message: "兑换码不存在。",
        };

        set((state) => {
          const code = state.redeemCodes.find((item) => item.code.toUpperCase() === normalizedCode);
          if (!code) return state;

          const status = getCodeStatus(code, now);
          if (status === "used") {
            result = { ok: false, message: "兑换码已使用。" };
            return { redeemCodes: state.redeemCodes.map((item) => (item.id === code.id ? { ...item, status, updatedAt: now } : item)) };
          }
          if (status === "disabled") {
            result = { ok: false, message: "兑换码已停用。" };
            return state;
          }
          if (status === "expired") {
            result = { ok: false, message: "兑换码已过期。" };
            return { redeemCodes: state.redeemCodes.map((item) => (item.id === code.id ? { ...item, status, updatedAt: now } : item)) };
          }

          const pkg = state.packages.find((item) => item.id === code.packageId);
          if (!pkg || !pkg.enabled) {
            result = { ok: false, message: "兑换码对应的套餐不可用。" };
            return state;
          }

          const amount = getPackageTotal(pkg);
          const account = getOrCreateAccount(state.accounts, userId, now);
          const nextAccount: CreditAccount = {
            ...account,
            balance: account.balance + amount,
            totalEarned: account.totalEarned + amount,
            updatedAt: now,
          };

          result = { ok: true, amount, packageName: pkg.name };
          return {
            redeemCodes: state.redeemCodes.map((item) =>
              item.id === code.id
                ? { ...item, status: "used", usedByUserId: userId, usedAt: now, updatedAt: now }
                : item
            ),
            accounts: writeAccount(state.accounts, nextAccount),
            transactions: [
              makeTransaction(
                {
                  userId,
                  type: "redeem_code",
                  amount,
                  balanceBefore: account.balance,
                  balanceAfter: nextAccount.balance,
                  redeemCodeId: code.id,
                  packageId: pkg.id,
                  note: `兑换套餐：${pkg.name}`,
                },
                now
              ),
              ...state.transactions,
            ],
          };
        });

        return result;
      },
      spendCredits: (input) => {
        const now = Date.now();
        const amount = normalizeAmount(input.amount);
        if (amount <= 0) return { ok: true };

        let result: { ok: true } | { ok: false; message: string } = { ok: true };
        set((state) => {
          const account = getOrCreateAccount(state.accounts, input.userId, now);
          if (account.balance < amount) {
            result = { ok: false, message: `积分不足，当前 ${account.balance}，本次需要 ${amount}。` };
            return state;
          }

          const nextAccount: CreditAccount = {
            ...account,
            balance: account.balance - amount,
            totalSpent: account.totalSpent + amount,
            updatedAt: now,
          };

          return {
            accounts: writeAccount(state.accounts, nextAccount),
            transactions: [
              makeTransaction(
                {
                  userId: input.userId,
                  type: "generation_cost",
                  amount: -amount,
                  balanceBefore: account.balance,
                  balanceAfter: nextAccount.balance,
                  generationTaskId: input.generationTaskId,
                  note: input.note,
                },
                now
              ),
              ...state.transactions,
            ],
          };
        });

        return result;
      },
      refundCredits: (input) => {
        const now = Date.now();
        const amount = normalizeAmount(input.amount);
        if (amount <= 0) return;

        set((state) => {
          const account = getOrCreateAccount(state.accounts, input.userId, now);
          const nextAccount: CreditAccount = {
            ...account,
            balance: account.balance + amount,
            totalEarned: account.totalEarned + amount,
            updatedAt: now,
          };

          return {
            accounts: writeAccount(state.accounts, nextAccount),
            transactions: [
              makeTransaction(
                {
                  userId: input.userId,
                  type: "generation_refund",
                  amount,
                  balanceBefore: account.balance,
                  balanceAfter: nextAccount.balance,
                  generationTaskId: input.generationTaskId,
                  note: input.note,
                },
                now
              ),
              ...state.transactions,
            ],
          };
        });
      },
      adjustCredits: (userId, rawAmount, note) => {
        const now = Date.now();
        const amount = Number.isFinite(rawAmount) ? Math.round(rawAmount * 10000) / 10000 : 0;
        if (!Number.isFinite(amount) || amount === 0) return;

        set((state) => {
          const account = getOrCreateAccount(state.accounts, userId, now);
          const balanceAfter = Math.max(0, account.balance + amount);
          const appliedAmount = balanceAfter - account.balance;
          if (appliedAmount === 0) return state;

          const nextAccount: CreditAccount = {
            ...account,
            balance: balanceAfter,
            totalEarned: appliedAmount > 0 ? account.totalEarned + appliedAmount : account.totalEarned,
            totalSpent: appliedAmount < 0 ? account.totalSpent + Math.abs(appliedAmount) : account.totalSpent,
            updatedAt: now,
          };

          return {
            accounts: writeAccount(state.accounts, nextAccount),
            transactions: [
              makeTransaction(
                {
                  userId,
                  type: "admin_adjust",
                  amount: appliedAmount,
                  balanceBefore: account.balance,
                  balanceAfter,
                  note: note.trim() || "后台调整积分",
                },
                now
              ),
              ...state.transactions,
            ],
          };
        });
      },
    }),
    {
      name: "koala-credit-store-v1",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({
        packages: state.packages,
        redeemCodes: state.redeemCodes,
        accounts: state.accounts,
        transactions: state.transactions,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    } satisfies PersistOptions<CreditState, PersistedCreditState>
  )
);

export function getRedeemCodeDisplayStatus(code: RedeemCode) {
  return getCodeStatus(code);
}

export function getCreditPackageTotal(pkg: CreditPackage) {
  return getPackageTotal(pkg);
}
