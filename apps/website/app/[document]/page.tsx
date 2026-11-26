import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../components/site-shell";
import data from "../data/legal.json";
import { GITHUB_URL, SITE_URL, sitePath, sourcePath } from "../site";
type Key = keyof typeof data;
const documents: Record<
  string,
  {
    title: string;
    eyebrow: string;
    lead: string;
    sections: { heading: string; paragraphs: string[] }[];
    links?: { label: string; href: string }[];
  }
> = data;
export const dynamicParams = false;
export function generateStaticParams() {
  return Object.keys(data).map((document) => ({ document }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>;
}): Promise<Metadata> {
  const { document } = await params;
  const doc = documents[document];
  return doc
    ? {
        title: doc.title,
        description: doc.lead,
        alternates: { canonical: new URL(document + "/", SITE_URL).toString() },
      }
    : {};
}
export default async function DocumentPage({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  if (!(document in data)) notFound();
  const doc = documents[document as Key];
  const license =
    document === "licenses"
      ? readFileSync(path.join(process.cwd(), "../../LICENSE"), "utf8")
      : undefined;
  return (
    <>
      <SiteHeader />
      <main id="main" className="document-page">
        <a className="back-link" href={sitePath()}>
          紹介ページへ戻る
        </a>
        <p className="eyebrow">{doc.eyebrow}</p>
        <h1>{doc.title}</h1>
        <p className="document-lead">{doc.lead}</p>
        <p className="document-date">更新日：2026年11月26日</p>
        <div className="document-content">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          {license && (
            <section>
              <h2>MIT License 原文</h2>
              <pre className="license-text">{license}</pre>
              <a href={sourcePath("LICENSE")}>リポジトリの LICENSE</a>
            </section>
          )}
          {doc.links && (
            <section>
              <h2>参照先</h2>
              <ul>
                {doc.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h2>関連する文書</h2>
            <ul>
              <li>
                <a href={sourcePath("README.md")}>README：実装と制約</a>
              </li>
              <li>
                <a href={sourcePath("docs/development/validation-handoff.md")}>
                  未完了検証と引き継ぎ用プロンプト
                </a>
              </li>
              <li>
                <a href={GITHUB_URL + "/issues"}>Issues・お問い合わせ（公開）</a>
              </li>
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
