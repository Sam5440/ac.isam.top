"use client";

/**
 * 文件管理（/ide 侧栏「文件」视图，VS Code Explorer 式文件树）：
 *  - 多级文件夹：展开 / 折叠，选中文件夹后「新建文件 / 新建文件夹」落在其内；
 *  - 行内新建 / 重命名（Enter 确认、Esc 取消；输入 a/b/c.cpp 自动建中间目录），
 *    拖拽文件 / 文件夹到目标文件夹即移动；右键菜单；F2 重命名、Delete 删除；
 *  - 上传文件 / 上传文件夹（保留目录结构）、单文件下载、全部 ZIP。
 */

import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  FilePlus,
  Folder,
  FolderDown,
  FolderOpen,
  FolderPlus,
  FolderUp,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { buildZip } from "@/lib/ide-zip";
import { ActionButton, ContextMenu, FileIcon, ViewHeader } from "@/components/ide/vsc";

const INDENT = 10;

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件 + 文件夹 → 树。返回 {dirs: Map<path, {path,name,children:[]}>, root}。 */
function buildTree(files, folders) {
  const root = { path: "", name: "", type: "dir", children: [] };
  const dirs = new Map([["", root]]);
  const ensureDir = (p) => {
    if (dirs.has(p)) return dirs.get(p);
    const i = p.lastIndexOf("/");
    const parent = ensureDir(i < 0 ? "" : p.slice(0, i));
    const node = { path: p, name: p.slice(i + 1), type: "dir", children: [] };
    parent.children.push(node);
    dirs.set(p, node);
    return node;
  };
  for (const d of folders) ensureDir(d);
  for (const f of files) {
    const i = f.path.lastIndexOf("/");
    ensureDir(i < 0 ? "" : f.path.slice(0, i)).children.push({ ...f, type: "file" });
  }
  const sort = (n) => {
    n.children.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach((c) => c.type === "dir" && sort(c));
  };
  sort(root);
  return { root, dirs };
}

const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir, name) => (dir ? `${dir}/${name}` : name);

function InlineInput({ initial = "", isDir, depth, onSubmit, onCancel }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (ok) => {
    if (done.current) return;
    done.current = true;
    ok && v.trim() ? onSubmit(v.trim()) : onCancel();
  };
  return (
    <div className="flex h-[22px] items-center gap-1.5 pr-2" style={{ paddingLeft: 8 + depth * INDENT + 16 }}>
      {isDir ? <Folder className="size-4 shrink-0 opacity-80" strokeWidth={1.5} /> : <FileIcon name={v} />}
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onFocus={(e) => {
          const dot = e.target.value.lastIndexOf(".");
          e.target.setSelectionRange(0, !isDir && dot > 0 ? dot : e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
        aria-label={isDir ? "文件夹名" : "文件名"}
        spellCheck={false}
        className="vsc-input !h-[20px] !px-1 text-[13px]"
      />
    </div>
  );
}

export default function FileManager({
  files,
  folders = [],
  activePath,
  isDirty,
  onOpen,
  onCreate, // (path) 新建文件
  onCreateFolder, // (path)
  onRename, // (from, to) 文件
  onRenameFolder, // (from, to)
  onDelete, // (path) 文件
  onDeleteFolder, // (path)
  onUpload, // (FileList, dir)
  onRefresh,
}) {
  const { root } = useMemo(() => buildTree(files, folders), [files, folders]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [selected, setSelected] = useState(null); // {path, type}
  const [creating, setCreating] = useState(null); // {dir, type:'file'|'dir'}
  const [renaming, setRenaming] = useState(null); // {path, type}
  const [menu, setMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const uploadRef = useRef(null);
  const uploadDirRef = useRef(null);
  const uploadTarget = useRef("");

  const toggle = (p) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  const expandTo = (dir) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      const parts = dir.split("/").filter(Boolean);
      parts.forEach((_, i) => n.add(parts.slice(0, i + 1).join("/")));
      return n;
    });

  /** 新建/上传的目标目录：选中文件夹 → 它；选中文件 → 其父目录；否则根。 */
  const targetDir = () => (selected ? (selected.type === "dir" ? selected.path : parentOf(selected.path)) : "");

  const startCreate = (type, dir = targetDir()) => {
    if (dir) expandTo(dir);
    setCreating({ dir, type });
  };

  const downloadAll = () => {
    if (!files.length) return;
    try {
      const enc = new TextEncoder();
      saveBlob(buildZip(files.map((f) => ({ name: f.path, data: enc.encode(f.content) }))), "ide-workspace.zip");
      toast.success(`已打包 ${files.length} 个文件`);
    } catch (exn) {
      toast.error(`打包失败：${exn.message}`);
    }
  };

  const upload = (dirMode, dir = targetDir()) => {
    uploadTarget.current = dir;
    (dirMode ? uploadDirRef : uploadRef).current?.click();
  };

  const move = (src, destDir) => {
    const name = src.path.split("/").pop();
    const to = join(destDir, name);
    if (to === src.path || destDir === src.path || destDir.startsWith(`${src.path}/`)) return;
    if (src.type === "dir") onRenameFolder(src.path, to);
    else onRename(src.path, to);
    if (destDir) expandTo(destDir);
  };

  const rowStyle = (depth) => ({ paddingLeft: 8 + depth * INDENT });
  const rowCls = (isSel, isActive, isDrop) =>
    `group flex h-[22px] w-full cursor-pointer items-center gap-1 pr-2 text-left text-[13px] ${
      isDrop
        ? "bg-[color:var(--vsc-hover)] outline outline-1 -outline-offset-1 outline-[color:var(--vsc-accent)]"
        : isSel
          ? "bg-[color:var(--vsc-focus-selection)] outline outline-1 -outline-offset-1 outline-[color:var(--vsc-accent)]"
          : isActive
            ? "bg-[color:var(--vsc-selection)]"
            : "hover:bg-[color:var(--vsc-hover)]"
    }`;

  const dndProps = (node) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData("application/x-ide-path", JSON.stringify({ path: node.path, type: node.type }));
      e.dataTransfer.effectAllowed = "move";
    },
    ...(node.type === "dir"
      ? {
          onDragOver: (e) => {
            if (!e.dataTransfer.types.includes("application/x-ide-path")) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(node.path);
          },
          onDragLeave: () => setDropTarget((t) => (t === node.path ? null : t)),
          onDrop: (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            try {
              move(JSON.parse(e.dataTransfer.getData("application/x-ide-path")), node.path);
            } catch {}
          },
        }
      : {}),
  });

  const renderChildren = (dirNode, depth) => {
    const out = [];
    for (const n of dirNode.children) out.push(renderNode(n, depth));
    if (creating && creating.dir === dirNode.path) {
      out.push(
        <li key="__creating">
          <InlineInput
            isDir={creating.type === "dir"}
            depth={depth}
            onSubmit={(v) => {
              setCreating(null);
              const p = join(creating.dir, v);
              if (creating.type === "dir") {
                onCreateFolder(p);
                expandTo(p);
              } else {
                onCreate(p);
                if (p.includes("/")) expandTo(parentOf(p));
              }
            }}
            onCancel={() => setCreating(null)}
          />
        </li>,
      );
    }
    return out;
  };

  const renderNode = (n, depth) => {
    if (renaming && renaming.path === n.path) {
      return (
        <li key={n.path}>
          <InlineInput
            initial={n.name}
            isDir={n.type === "dir"}
            depth={depth}
            onSubmit={(v) => {
              setRenaming(null);
              const to = join(parentOf(n.path), v);
              if (to === n.path) return;
              n.type === "dir" ? onRenameFolder(n.path, to) : onRename(n.path, to);
            }}
            onCancel={() => setRenaming(null)}
          />
        </li>
      );
    }
    const isSel = selected?.path === n.path;
    if (n.type === "dir") {
      const open = expanded.has(n.path);
      return (
        <li key={n.path} role="treeitem" aria-expanded={open}>
          <div
            className={rowCls(isSel, false, dropTarget === n.path)}
            style={rowStyle(depth)}
            tabIndex={0}
            onClick={() => {
              setSelected({ path: n.path, type: "dir" });
              toggle(n.path);
            }}
            onFocus={() => setSelected({ path: n.path, type: "dir" })}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelected({ path: n.path, type: "dir" });
              setMenu({ x: e.clientX, y: e.clientY, node: n });
            }}
            {...dndProps(n)}
          >
            {open ? <ChevronDown className="size-4 shrink-0 opacity-80" strokeWidth={1.5} /> : <ChevronRight className="size-4 shrink-0 opacity-80" strokeWidth={1.5} />}
            {open ? <FolderOpen className="size-4 shrink-0 text-[color:var(--vsc-warning)]" strokeWidth={1.5} /> : <Folder className="size-4 shrink-0 text-[color:var(--vsc-warning)]" strokeWidth={1.5} />}
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
          </div>
          {open && <ul role="group">{renderChildren(n, depth + 1)}</ul>}
        </li>
      );
    }
    const dirty = isDirty?.(n);
    return (
      <li key={n.path} role="treeitem">
        <div
          className={rowCls(isSel, n.path === activePath, false)}
          style={{ paddingLeft: 8 + depth * INDENT + 16 }}
          tabIndex={0}
          title={n.path}
          onClick={() => {
            setSelected({ path: n.path, type: "file" });
            onOpen(n.path);
          }}
          onFocus={() => setSelected({ path: n.path, type: "file" })}
          onContextMenu={(e) => {
            e.preventDefault();
            setSelected({ path: n.path, type: "file" });
            setMenu({ x: e.clientX, y: e.clientY, node: n });
          }}
          {...dndProps(n)}
        >
          <FileIcon lang={n.lang} name={n.name} />
          <span className={`min-w-0 flex-1 truncate ${dirty ? "text-[color:var(--vsc-warning)]" : ""}`}>{n.name}</span>
          {dirty && <span className="text-[11px] font-semibold text-[color:var(--vsc-warning)]">M</span>}
        </div>
      </li>
    );
  };

  const menuItems = (node) => {
    if (!node)
      return [
        { label: "新建文件…", onClick: () => startCreate("file", "") },
        { label: "新建文件夹…", onClick: () => startCreate("dir", "") },
        "sep",
        { label: "上传文件…", onClick: () => upload(false, "") },
        { label: "上传文件夹…", onClick: () => upload(true, "") },
        { label: "下载全部（ZIP）", onClick: downloadAll },
      ];
    if (node.type === "dir")
      return [
        { label: "新建文件…", onClick: () => startCreate("file", node.path) },
        { label: "新建文件夹…", onClick: () => startCreate("dir", node.path) },
        { label: "上传文件到此处…", onClick: () => upload(false, node.path) },
        "sep",
        { label: "复制路径", onClick: () => navigator.clipboard?.writeText(node.path) },
        "sep",
        { label: "重命名…", keybinding: "F2", onClick: () => setRenaming({ path: node.path, type: "dir" }) },
        { label: "删除", keybinding: "Delete", onClick: () => onDeleteFolder(node.path) },
      ];
    return [
      { label: "打开", onClick: () => onOpen(node.path) },
      "sep",
      { label: "下载", onClick: () => saveBlob(new Blob([node.content], { type: "text/plain;charset=utf-8" }), node.name) },
      { label: "复制路径", onClick: () => navigator.clipboard?.writeText(node.path) },
      "sep",
      { label: "重命名…", keybinding: "F2", onClick: () => setRenaming({ path: node.path, type: "file" }) },
      { label: "删除", keybinding: "Delete", onClick: () => onDelete(node.path) },
    ];
  };

  return (
    <section
      aria-label="文件管理"
      className="flex h-full min-w-0 flex-col overflow-hidden"
      onKeyDown={(e) => {
        if (!selected || renaming || creating || e.target.tagName === "INPUT") return;
        if (e.key === "F2") {
          e.preventDefault();
          setRenaming(selected);
        } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) {
          e.preventDefault();
          selected.type === "dir" ? onDeleteFolder(selected.path) : onDelete(selected.path);
        }
      }}
    >
      <ViewHeader
        title="文件"
        actions={
          <>
            <ActionButton icon={FilePlus} title="新建文件…" onClick={() => startCreate("file")} />
            <ActionButton icon={FolderPlus} title="新建文件夹…" onClick={() => startCreate("dir")} />
            <ActionButton icon={Upload} title="上传文件…" onClick={() => upload(false)} />
            <ActionButton icon={FolderUp} title="上传文件夹…" onClick={() => upload(true)} />
            <ActionButton icon={FolderDown} title="下载全部（ZIP）" onClick={downloadAll} disabled={!files.length} />
            <ActionButton icon={RefreshCw} title="刷新" onClick={onRefresh} />
            <ActionButton icon={ChevronsDownUp} title="全部折叠" onClick={() => setExpanded(new Set())} />
          </>
        }
      />
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onUpload(e.target.files, uploadTarget.current);
          e.target.value = "";
        }}
      />
      <input
        ref={uploadDirRef}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onUpload(e.target.files, uploadTarget.current);
          e.target.value = "";
        }}
      />
      <ul
        role="tree"
        aria-label="工作区文件"
        className="min-h-0 flex-1 overflow-auto pb-6"
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setSelected(null);
            setMenu({ x: e.clientX, y: e.clientY, node: null });
          }
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-ide-path")) return;
          e.preventDefault();
          setDropTarget("");
        }}
        onDragLeave={(e) => e.target === e.currentTarget && setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(null);
          try {
            move(JSON.parse(e.dataTransfer.getData("application/x-ide-path")), "");
          } catch {}
        }}
        style={dropTarget === "" ? { outline: "1px solid var(--vsc-accent)", outlineOffset: -1 } : undefined}
      >
        {!files.length && !folders.length && !creating && (
          <li className="px-4 py-2 text-[12px] leading-5">
            <p className="opacity-75">工作区为空。</p>
            <button type="button" className="vsc-btn mt-2 w-full" onClick={() => startCreate("file", "")}>
              新建文件
            </button>
          </li>
        )}
        {renderChildren(root, 0)}
      </ul>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.node)} />}
    </section>
  );
}
