import React from "react";
import { X } from "lucide-react";

export default function AttachmentPreview({ files, onRemove }: { files: File[]; onRemove: (idx: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {files.map((f, i) => (
        <div key={i} className="relative">
          <img src={URL.createObjectURL(f)} className="h-16 w-16 rounded-lg object-cover" />
          <button onClick={() => onRemove(i)} className="absolute -top-1 -right-1 bg-red-600 rounded-full text-white text-[10px] leading-none px-[3px]">
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
