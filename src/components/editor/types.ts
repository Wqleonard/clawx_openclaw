// src/components/editor/types.ts

import type { JSONContent } from "@tiptap/core";

export type EditorEventName = string;

export type EditorContentType = "markdown" | "html" | "json";
export type EditorContentValue = string | JSONContent;

export interface EditorEventBus {
    emit<T = any>(event: EditorEventName, payload?: T): void;
    on<T = any>(event: EditorEventName, handler: (payload: T) => void): () => void; // 返回 off()
    once?<T = any>(event: EditorEventName, handler: (payload: T) => void): () => void; // 可选
}

export interface EditorPublicState {
    workId?: string;
    currentEditingId?: string;
    activeTab?: "chat" | "faq" | "canvas" | string;

    // 是否开启编辑
    isEditorEditable?: boolean;

    // 当前编辑内容
    currentContent?: EditorContentValue;
    // 当前编辑内容的格式
    currentContentType?: EditorContentType;
    // sidebarTreeData?: FileTreeNode[];  // 根据后续复用需求决定是否公开
}

export interface EditorRef {
    // 编辑器命令
    commands: Record<string, (...args: any[]) => any>;
    // 获取编辑器状态
    getState(): EditorPublicState;
    // 事件总线
    bus: EditorEventBus;
}

export interface EditorDomRefs {
    rootRef: React.RefObject<HTMLDivElement | null>;
  }
  
  export interface EditorServices {
    // api/埋点/存储等都挂这里
  }
  
  export interface EditorCtx {
    services?: EditorServices;
    refs: EditorDomRefs;
  
    // 内部状态
    getState: () => EditorPublicState;
    setState: (patch: Partial<EditorPublicState>) => void;
  
    bus: EditorEventBus;
  
    addDisposer: (fn: () => void) => void;
    registerCommands: (pluginId: string, commands: Record<string, (...args: any[]) => any>) => void;
  }
  
  export interface EditorPlugin {
    id: string;
    setup?: (ctx: EditorCtx) => void | Promise<void>;
    onMount?: (ctx: EditorCtx) => void | Promise<void>;
    onUnmount?: (ctx: EditorCtx) => void;
    commands?: (ctx: EditorCtx) => Record<string, (...args: any[]) => any>;
  }