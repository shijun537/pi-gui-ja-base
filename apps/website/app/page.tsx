import { CopyCommand } from "./components/copy-command";
import { SiteFooter, SiteHeader } from "./components/site-shell";
import { GITHUB_URL, UPSTREAM_URL, sitePath, sourcePath } from "./site";
const features = [
  {
    tag: "日本語で迷わず",
    title: "画面も、作業の入口も。",
    body: "会話、設定、レビュー、Windows メニューまで、日本語の操作を重点的に整備。モデル名や外部サービスの原文は、そのまま扱います。",
    path: "apps/desktop/src/i18n/messages/ja.ts",
    label: "日本語の表示文言",
  },
  {
    tag: "相談から実装へ",
    title: "フォルダは、あとでいい。",
    body: "まずはフォルダ不要のチャットで相談。やることが決まったら、要点の下書きを確認・編集し、選んだプロジェクトで続けられます。",
    path: "apps/desktop/tests/core/folderless-chat.spec.ts",
    label: "チャットと引き継ぎの試験",
  },
  {
    tag: "話して下書きに",
    title: "声を、端末内でテキストに。",
    body: "Whisper の文字起こしを下書きへ。GPU 実行と CPU への復帰に対応します。初回に約3.1 GB のモデル取得が必要で、実マイクの待ち時間と最低スペックは検証中です。",
    path: "apps/desktop/electron/platform/voice-input.ts",
    label: "音声入力の実装",
  },
];
const places = [
  ["表示と入力欄", "画面や操作を、自分の使い方に。", "apps/desktop/src/features"],
  ["日本語の文言", "翻訳をまとめて管理する。", "apps/desktop/src/i18n/messages/ja.ts"],
  ["Pi との連携", "エージェント本体と GUI の役割を分ける。", "packages/pi-sdk-driver"],
  ["確認の手順", "実装と一緒に、試験も引き継ぐ。", "apps/desktop/tests"],
];
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">A JAPANESE STARTING POINT FOR PI</p>
            <h1>
              日本語で使う。
              <br />
              自分の道具に<span>育てる。</span>
            </h1>
            <p className="hero-lead">
              完成品を選ぶ、その先へ。
              <br />
              相談から作業までつながる Pi の GUI を、
              <br className="desktop-break" />
              あなたの用途に合わせてつくり変える。
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={GITHUB_URL}>
                GitHub でソースを見る
              </a>
              <a className="button button-quiet" href="#features">
                このベースの特徴
              </a>
            </div>
            <p className="hero-note">MIT License · 非公式フォーク · 開発中のソース公開</p>
          </div>
          <div className="app-figure">
            <div
              className="mock-window"
              role="img"
              aria-label="相談からプロジェクトへ引き継ぐ画面構成の説明イメージ"
            >
              <div className="mock-title">
                <span className="mock-dots">● ● ●</span>
                <span>pi-gui-ja-base</span>
                <span className="mock-language">日本語</span>
              </div>
              <div className="mock-body">
                <aside className="mock-sidebar">
                  <span className="mock-new">＋ 新しい会話</span>
                  <small>チャット</small>
                  <div className="mock-selected">小さな道具をつくる</div>
                  <small>プロジェクト</small>
                  <div>▱ サンプルアプリ</div>
                  <div className="mock-bottom">設定　 /　 スキル</div>
                </aside>
                <div className="mock-chat">
                  <p className="mock-chat-title">まずは、アイデアの相談から</p>
                  <div className="mock-user">毎日の作業に合う、小さなアプリをつくりたい。</div>
                  <div className="mock-response">
                    <span className="mock-pi">π</span>
                    <p>
                      どんな場面で使いたいですか？
                      <br />
                      考えを整理して、作業の下書きにしましょう。
                    </p>
                  </div>
                  <div className="handoff-note">
                    <span>プロジェクトで続ける</span>
                    <p>
                      相談の要点を確認してから、
                      <br />
                      選んだフォルダで作業を開始。
                    </p>
                    <div className="mini-tags">
                      <span>要点を編集</span>
                      <span>元の会話を保持</span>
                    </div>
                  </div>
                  <div className="mock-composer">
                    <span>ここから、続きを話そう。</span>
                    <div>
                      <small>読むだけ</small>
                      <span>マイク　 ↑</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p className="figure-caption">
              画面構成の説明イメージです。実アプリのスクリーンショットではありません。
            </p>
          </div>
        </section>
        <section className="intro-band">
          <p>日本語UIを、使うだけで終わらせない。</p>
          <div>
            <strong>pi-gui-ja-base</strong>
            <span>
              上流の会話・レビュー・端末を土台に、
              <br />
              日本語での相談と、自分で改造する入口を整えます。
            </span>
          </div>
        </section>
        <section className="section feature-section" id="features">
          <div className="section-heading">
            <p className="eyebrow">WHY THIS BASE</p>
            <h2>
              あなたの作業に、
              <br />
              近いところから。
            </h2>
            <p>
              このフォークが重点を置くのは、日本語で考え、
              <br />
              相談し、必要な機能を自分で育てていく体験です。
            </p>
          </div>
          <div className="feature-list">
            {features.map((f) => (
              <article key={f.tag}>
                <span className="feature-tag">{f.tag}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <a className="text-link" href={sourcePath(f.path)}>
                  {f.label}
                </a>
              </article>
            ))}
          </div>
        </section>
        <section className="section customize-section" id="customize">
          <div className="section-heading">
            <p className="eyebrow">MAKE IT YOURS</p>
            <h2>
              使い方に合わせて、
              <br />
              手を入れられる。
            </h2>
            <p>
              IDE
              の拡張としてではなく、独立したデスクトップの作業空間として。ソースと確認手順を入口に、自分の道具へ育てていけます。
            </p>
            <a className="text-link" href={sourcePath("docs/architecture.md")}>
              構成と実装の境界を読む
            </a>
          </div>
          <div className="source-map">
            {places.map(([title, body, file]) => (
              <a key={file} href={GITHUB_URL + "/tree/main/" + file}>
                <span>
                  <strong>{title}</strong>
                  <small>{body}</small>
                </span>
                <code>{file.replace("apps/desktop/", "desktop/")}</code>
              </a>
            ))}
          </div>
        </section>
        <section className="section honest-section" id="status">
          <div>
            <p className="eyebrow">OPEN ABOUT THE LIMITS</p>
            <h2>
              できたことも、
              <br />
              これからのことも。
            </h2>
            <p>
              他のGUIにない機能だとは断定しません。
              <br />
              重視する使い方と、確かめた範囲を公開します。
            </p>
            <a className="text-link" href={sitePath("status/")}>
              検証状況と既知の問題を読む
            </a>
          </div>
          <div className="status-ledger">
            <div>
              <span className="status-label verified">確認記録あり</span>
              <p>日本語UI・チャットの引き継ぎ・端末内音声入力</p>
              <small>機能ごとに、対象の版と条件が異なります。</small>
            </div>
            <div>
              <span className="status-label pending">今回の再確認は未完了</span>
              <p>新規導入・全体検査・実アプリの起動</p>
              <small>制限付き Windows 環境で停止。成功扱いにはしていません。</small>
            </div>
            <div>
              <span className="status-label pending">試作・採用判断待ち</span>
              <p>キー暗号化・送信先照合・Electron 更新など</p>
              <small>通常のアプリにすべて組み込まれているわけではありません。</small>
            </div>
          </div>
        </section>
        <section className="section start-section" id="start">
          <div className="section-heading">
            <p className="eyebrow">START FROM SOURCE</p>
            <h2>まずは、小さく試す。</h2>
            <p>
              現在は開発者向けのソース公開です。正式な Windows
              配布版のダウンロードは案内していません。
            </p>
            <div className="requirements">
              <span>Node.js 22.19+</span>
              <span>pnpm 10.25.0</span>
              <span>主な確認対象：Windows x64</span>
            </div>
          </div>
          <div className="start-panel">
            <p className="terminal-label">リポジトリを取得する</p>
            <CopyCommand command={"git clone " + GITHUB_URL + ".git"} />
            <p>
              アプリ用と Pi
              用の専用プロファイルを指定し、固定した依存関係を導入します。詳細な起動手順と環境の制約は
              README を参照してください。
            </p>
            <a className="button button-primary" href={sourcePath("README.md#ソースから起動する")}>
              README の導入手順へ
            </a>
            <a className="text-link" href={sourcePath("docs/development/validation-handoff.md")}>
              止まった検証を引き継ぐ
            </a>
          </div>
        </section>
        <section className="section faq-section">
          <div className="section-heading">
            <p className="eyebrow">BEFORE YOU BEGIN</p>
            <h2>気になること。</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>Pi 本体は別にインストールしますか？</summary>
              <p>
                GUI の依存関係を導入すると Pi の SDK も入ります。GUI だけを使う場合に CLI
                の別途導入は不要です。Pi をターミナルでも単独利用したい場合は、公式の npm
                導入手順と認証方法を案内しています。
              </p>
              <a href={sourcePath("docs/getting-started.md")}>Pi と GUI の導入ガイド</a>
            </details>
            <details>
              <summary>上流の pi-gui と何が違いますか？</summary>
              <p>
                日本語UI、フォルダ不要の相談、プロジェクトへの下書きの引き継ぎ、Windows
                の端末内音声入力などを追加・確認しています。上流の機能と本フォークの変更、試作だけの結果は
                README で区別しています。
              </p>
              <a href={UPSTREAM_URL}>上流プロジェクト</a>
            </details>
            <details>
              <summary>無料ですか？ 改造や再配布はできますか？</summary>
              <p>
                ソースは MIT License
                で公開します。改変・再配布などはライセンスの条件に従って行えます。モデルや外部サービスの利用料は別です。
              </p>
              <a href={sitePath("licenses/")}>ライセンスと謝辞</a>
            </details>
            <details>
              <summary>会話や音声はすべて端末内で処理されますか？</summary>
              <p>
                標準の音声文字起こしは端末内です。認識した文を含む会話や添付は、設定したモデルサービスへ送られる場合があります。タイトル生成や外部ツールも通信を伴います。
              </p>
              <a href={sitePath("privacy/")}>データの扱いを確認</a>
            </details>
            <details>
              <summary>実キーを登録して、すぐに仕事で使えますか？</summary>
              <p>
                キーの暗号化や隔離は製品実装が未完了です。まずはダミーキー・合成データ・専用プロファイルで確認してください。用途に合わせた検証とデータのバックアップが必要です。
              </p>
              <a href={sourcePath("SECURITY.md")}>セキュリティ上の制約</a>
            </details>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
