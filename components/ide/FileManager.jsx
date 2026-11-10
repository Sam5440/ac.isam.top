"use client";

/**
 * 文件管理器（/ide 右栏）：新建 / 重命名 / 删除（confirm）/ 上传多文件
 * （→ lib/ide-workspace.importFiles）/ 单文件下载（Blob）/ 全部下载 ZIP
 * （lib/ide-zip，store-only）。显示文件大小与未保存（脏）状态。
 */

import { useRef, useState } from "react";
import { Download, FilePlus2, FolderArchive, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { buildZip } from "@/lib/ide-zip";

const LANG_BADGE = { cpp: "C++", python: "PY" };

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export default function FileManager({
  files,
  activePath,
  isDirty,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onUpload,
  onRefresh,
}) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null); // path
  const [renameValue, setRenameValue] = useState("");
  const uploadRef = useRef(null);

  const doCreate = () => {
    onCreate(newName);
    setNewName("");
  };

  const downloadOne = (f) => {
    const url = URL.createObjectURL(new Blob([f.content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadAll = async () => {
    if (!files.length) return;
    try {
      const enc = new TextEncoder();
      const blob = buildZip(files.map((f) => ({ name: f.path, data: enc.encode(f.content) })));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ide-workspace.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`已打包 ${files.length} 个文件`);
    } catch (exn) {
      toast.error(`打包失败：${exn.message}`);
    }
  };

  return (
    <section
      aria-label="文件管理器"
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold tracking-wide">文件（{files.length}）</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-muted-foreground text-[11px] underline underline-offset-2 hover:text-foreground"
        >
          刷新
        </button>
      </div>

      {/* 新建 + 上传 + 下载全部 */}
      <div className="space-y-2 border-b px-3 py-2">
        <div className="flex gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doCreate()}
            placeholder="main.cpp / sol.py"
            aria-label="新文件名"
            className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs placeholder:text-muted-foreground"
          />
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={doCreate} title="新建文件">
            <FilePlus2 className="size-3.5" />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 px-2 text-xs"
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="size-3" />
            上传
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 px-2 text-xs"
            disabled={!files.length}
            onClick={downloadAll}
          >
            <FolderArchive className="size-3" />
            全部 ZIP
          </Button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* 文件列表 */}
      <ul className="max-h-72 overflow-auto px-1.5 py-1.5 lg:max-h-none">
        {files.length === 0 && (
          <li className="text-muted-foreground px-2 py-3 text-xs">工作区为空，新建或上传文件开始。</li>
        )}
        {files.map((f) => {
          const active = f.path === activePath;
          const dirty = isDirty?.(f);
          return (
            <li key={f.path}>
              {renaming === f.path ? (
                <div className="flex gap-1 px-1 py-1">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(f.path, renameValue);
                        setRenaming(null);
                      } else if (e.key === "Escape") {
                        setRenaming(null);
                      }
                    }}
                    autoFocus
                    aria-label="新路径"
                    className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      onRename(f.path, renameValue);
                      setRenaming(null);
                    }}
                  >
                    确定
                  </Button>
                </div>
              ) : (
                <div
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${
                    active ? "bg-muted/60" : "hover:bg-accent/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(f.path)}
                    className="min-w-0 flex-1 text-left"
                    title={f.path}
                  >
                    <span className="block truncate font-mono">{f.path}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {LANG_BADGE[f.lang] ?? f.lang} · {fmtSize(f.content.length)}
                      {dirty ? " · 未保存" : ""}
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(f.path);
                        setRenameValue(f.path);
                      }}
                      aria-label={`重命名 ${f.path}`}
                      title="重命名"
                      className="rounded p-1 hover:bg-accent"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadOne(f)}
                      aria-label={`下载 ${f.path}`}
                      title="下载"
                      className="rounded p-1 hover:bg-accent"
                    >
                      <Download className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(f.path)}
                      aria-label={`删除 ${f.path}`}
                      title="删除"
                      className="rounded p-1 text-red-500 hover:bg-accent"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                  {dirty && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="有未保存修改" />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
