import { GITHUB_URL, SITE_NAME, sitePath, sourcePath } from "../site";
export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <header className="site-header">
        <a className="wordmark" href={sitePath()}>
          <span className="brand-mark" aria-hidden="true">
            π
          </span>
          {SITE_NAME}
        </a>
        <nav aria-label="メインナビゲーション">
          <a href={sitePath("#features")}>特徴</a>
          <a href={sitePath("#start")}>はじめる</a>
          <a href={sitePath("status/")}>検証状況</a>
          <a className="nav-github" href={GITHUB_URL}>
            GitHub
          </a>
        </nav>
      </header>
    </>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <a className="wordmark" href={sitePath()}>
          <span className="brand-mark" aria-hidden="true">
            π
          </span>
          {SITE_NAME}
        </a>
        <p>日本語で使い、自分の用途に合わせて改造するための土台。</p>
        <small>上流 pi-gui をもとにした、開発中の非公式フォークです。</small>
      </div>
      <nav aria-label="フッターナビゲーション">
        <a href={sitePath("terms/")}>利用条件・免責</a>
        <a href={sitePath("privacy/")}>プライバシー</a>
        <a href={sitePath("licenses/")}>ライセンス・謝辞</a>
        <a href={sourcePath("SECURITY.md")}>セキュリティ</a>
        <a href={GITHUB_URL + "/issues"}>Issues・お問い合わせ</a>
      </nav>
      <div className="footer-bottom">
        <span>Based on pi-gui © Matthew Lam · MIT License</span>
        <span>ソース公開 / Windows x64 を中心に開発</span>
      </div>
    </footer>
  );
}
