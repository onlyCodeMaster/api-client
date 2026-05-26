import { useMemo, useState } from "react";
import { X, Copy, Check, Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CODEGEN_TARGETS, generateCode, type CodegenTarget } from "../utils/codegen";
import type { RequestItem } from "../types";

export function CodegenModal({
  request,
  onClose,
}: {
  request: RequestItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<CodegenTarget>("fetch");
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    try {
      return generateCode(request, target);
    } catch (err) {
      return `// ${t("codegen.error_prefix")}: ${String(err)}`;
    }
  }, [request, target, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[720px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Code2 size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">{t("codegen.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border-light flex items-center gap-2 flex-wrap">
          {CODEGEN_TARGETS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTarget(t.value)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                target === t.value
                  ? "bg-accent text-white"
                  : "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto bg-surface-secondary p-4 relative">
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 bg-surface rounded-md text-[11px] hover:bg-surface/80 transition-colors shadow-apple-sm"
          >
            {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
            {copied ? t("codegen.copied") : t("codegen.copy")}
          </button>
          <pre className="text-[12px] font-mono text-text-primary whitespace-pre-wrap break-all leading-[1.65]">
            {code}
          </pre>
        </div>
      </div>
    </div>
  );
}
