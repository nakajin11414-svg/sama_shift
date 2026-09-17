import { useMemo } from "react";
import { marked } from "marked";
import managerMd from "../content/manual-manager.md?raw";
import staffMd from "../content/manual-staff.md?raw";
import { Card } from "../ui.jsx";

// 説明書ページ。src/content/*.md を編集すれば内容が変わる
export default function ManualView({ kind }) {
  const html = useMemo(() => marked.parse(kind === "manager" ? managerMd : staffMd), [kind]);
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <Card className="p-6 manual" style={{ lineHeight: 1.7 }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
    </div>
  );
}
