import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { useCallback, useEffect } from 'react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Quote,
  Undo,
  Redo,
  Image as ImageIcon,
  Link as LinkIcon,
  Code,
  Minus,
} from 'lucide-react';

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onImageUpload?: (files: File[]) => Promise<string[]>;
}

function MenuBar({ editor, onImageUpload }: { editor: Editor; onImageUpload?: (files: File[]) => Promise<string[]> }) {
  const handleImageUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (!files.length || !onImageUpload) return;
      try {
        const urls = await onImageUpload(files);
        urls.forEach((url) => {
          editor.chain().focus().setImage({ src: url }).run();
        });
      } catch (error) {
        console.error('Image upload failed:', error);
        alert('图片上传失败');
      }
    };
    input.click();
  }, [editor, onImageUpload]);

  const handleAddLink = useCallback(() => {
    const url = window.prompt('输入链接地址:');
    if (!url) return;
    editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.08] bg-[#0d1016] p-2">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] disabled:opacity-30 ${
          editor.isActive('bold') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="粗体"
      >
        <Bold className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] disabled:opacity-30 ${
          editor.isActive('italic') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="斜体"
      >
        <Italic className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={!editor.can().chain().focus().toggleCode().run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] disabled:opacity-30 ${
          editor.isActive('code') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="行内代码"
      >
        <Code className="h-4 w-4" />
      </button>
      <div className="mx-1 h-6 w-px bg-white/[0.08]" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] ${
          editor.isActive('heading', { level: 1 }) ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="一级标题"
      >
        <Heading1 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] ${
          editor.isActive('heading', { level: 2 }) ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="二级标题"
      >
        <Heading2 className="h-4 w-4" />
      </button>
      <div className="mx-1 h-6 w-px bg-white/[0.08]" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] ${
          editor.isActive('bulletList') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="无序列表"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] ${
          editor.isActive('orderedList') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="有序列表"
      >
        <ListOrdered className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`rounded p-2 transition hover:bg-white/[0.08] ${
          editor.isActive('blockquote') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="引用"
      >
        <Quote className="h-4 w-4" />
      </button>
      <div className="mx-1 h-6 w-px bg-white/[0.08]" />
      <button
        type="button"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="rounded p-2 text-[#8f97aa] transition hover:bg-white/[0.08]"
        title="分隔线"
      >
        <Minus className="h-4 w-4" />
      </button>
      {onImageUpload ? (
        <button
          type="button"
          onClick={handleImageUpload}
          className="rounded p-2 text-[#8f97aa] transition hover:bg-white/[0.08]"
          title="插入图片"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={handleAddLink}
        className={`rounded p-2 transition hover:bg-white/[0.08] ${
          editor.isActive('link') ? 'bg-white/[0.12] text-white' : 'text-[#8f97aa]'
        }`}
        title="插入链接"
      >
        <LinkIcon className="h-4 w-4" />
      </button>
      <div className="mx-1 h-6 w-px bg-white/[0.08]" />
      <button
        type="button"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().chain().focus().undo().run()}
        className="rounded p-2 text-[#8f97aa] transition hover:bg-white/[0.08] disabled:opacity-30"
        title="撤销"
      >
        <Undo className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().chain().focus().redo().run()}
        className="rounded p-2 text-[#8f97aa] transition hover:bg-white/[0.08] disabled:opacity-30"
        title="重做"
      >
        <Redo className="h-4 w-4" />
      </button>
    </div>
  );
}

export function RichTextEditor({ content, onChange, placeholder = '开始输入内容...', onImageUpload }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-cyan-300 underline hover:text-cyan-200',
        },
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[400px] px-4 py-3',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141b]">
      <MenuBar editor={editor} onImageUpload={onImageUpload} />
      <div className="prose-editor min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} placeholder={placeholder} />
      </div>
    </div>
  );
}
