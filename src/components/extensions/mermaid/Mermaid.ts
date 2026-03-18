import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import MermaidComponent from "./MermaidComponent";

const Mermaid = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      code: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (node) => {
          if (typeof node === "string") return false;
          if (!(node instanceof HTMLElement)) return false;
          const codeElement = node.querySelector("code");
          if (!codeElement) return false;
          if (!codeElement.classList.contains("language-mermaid")) return false;
          return {
            code: codeElement.textContent || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const code = (HTMLAttributes.code as string) || "";
    return [
      "pre",
      mergeAttributes({ code }),
      ["code", { class: "language-mermaid" }, code],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidComponent);
  },

  markdownTokenizer: {
    name: "mermaid",
    level: "block",
    start: (src: string) => {
      const match = /^```mermaid\b/m.exec(src);
      return match ? match.index : -1;
    },
    tokenize: (src: string) => {
      const match = /^```mermaid[ \t]*\n([\s\S]*?)\n```/.exec(src);
      if (!match) return undefined;
      return {
        type: "mermaid",
        raw: match[0],
        code: match[1] || "",
      };
    },
  },

  parseMarkdown: (token: { type?: string; code?: string; raw?: string; info?: string }, _helpers: unknown) => {
    if (token.type === "fence" && token.info?.trim() === "mermaid") {
      return {
        type: "mermaid",
        attrs: { code: token.raw?.replace(/^```mermaid[ \t]*\n?/, "").replace(/\n?```$/, "") ?? "" },
      };
    }
    return {
      type: "mermaid",
      attrs: { code: token.code || "" },
    };
  },

  renderMarkdown: (node: { attrs?: { code?: string } }) => {
    return `\`\`\`mermaid\n${node.attrs?.code || ""}\n\`\`\``;
  },
});

export default Mermaid;
