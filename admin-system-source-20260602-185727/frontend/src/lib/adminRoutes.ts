export const ADMIN_BASE_PATH = "/appadminklkl9988";
export const ADMIN_LOGIN_PATH = `${ADMIN_BASE_PATH}/login`;

export function adminPath(path = "") {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${ADMIN_BASE_PATH}${suffix === "/" ? "" : suffix}`;
}
