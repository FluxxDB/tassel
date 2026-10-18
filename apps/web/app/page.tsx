import { ButtonLink } from '../components/Button';
import { DownloadButton } from '../components/DownloadButton';
import { Footer } from '../components/Footer';
import { HeroStage } from '../components/HeroStage';
import { Navbar } from '../components/Navbar';

const FEATURES = [
  {
    eyebrow: 'Voice',
    title: 'Talks it through out loud',
    body: 'A real conversation, not a chat box. Interrupt her mid-sentence, or let her interrupt you when she spots something.',
    tint: 'bg-blush',
  },
  {
    eyebrow: 'Paper view',
    title: 'Watches the page on your desk',
    body: "Desk View on your Mac's camera, or an iPhone through Continuity Camera, shows her your worksheet as you write.",
    tint: 'bg-meringue',
  },
  {
    eyebrow: 'Showing, not telling',
    title: 'Draws on your own work',
    body: 'She marks up your paper to show where it goes wrong, then redraws it step by step on a shared whiteboard.',
    tint: 'bg-mint',
  },
  {
    eyebrow: 'English · Español · 한국어',
    title: 'In your language',
    body: 'Learn in English, Spanish or Korean, from a tutor you customize, and understand why, not just what.',
    tint: 'bg-sky',
  },
];

export default function Home() {
  return (
    <>
      <Navbar />
      <main id="top">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="mono rounded-pill border border-hairline bg-paper px-3 py-1 text-[11px] text-smoke-text">
              Live AI tutor for Mac
            </p>
            <h1 className="mt-6 text-balance text-[40px] leading-[1.08] font-w520 tracking-[-0.035em] sm:text-[56px]">
              A tutor that sees your work and draws on it.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-[17px] leading-relaxed text-slate-plum sm:text-lg">
              Tassel watches the paper or screen in front of you, talks it through out loud, and
              marks up your own work, so you understand why it's wrong.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <DownloadButton note />
              <ButtonLink href="#features" variant="ghost" size="lg">
                See how it works
              </ButtonLink>
            </div>
          </div>
          <div className="mx-auto mt-14 max-w-5xl sm:mt-16">
            <HeroStage />
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="mono text-[11px] text-smoke-text">How it works</p>
            <h2 className="mt-3 text-balance text-[30px] leading-[1.15] font-w520 tracking-[-0.03em] sm:text-[36px]">
              Not a chatbot you type into.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-slate-plum">
              Keep your pencil. Tassel sits beside your homework the way a good tutor would:
              watching, listening, and stepping in at the right moment.
            </p>
          </div>
          <ul className="mt-10 grid gap-3 sm:grid-cols-2 sm:gap-4">
            {FEATURES.map((f) => (
              <li key={f.title} className={`${f.tint} flex flex-col gap-3 rounded-card p-6 sm:p-8`}>
                <p className="mono text-[11px] text-smoke-text">{f.eyebrow}</p>
                <h3 className="text-[22px] leading-tight font-w520 tracking-[-0.025em]">
                  {f.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-slate-plum">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="download" className="mx-auto max-w-6xl px-4 pb-20 pt-4 sm:px-6 sm:pb-28">
          <div className="flex flex-col items-center rounded-hero bg-ink px-6 py-14 text-center sm:py-20">
            <p className="mono text-[11px] text-caption-muted">Download</p>
            <h2 className="mt-4 max-w-xl text-balance text-[30px] leading-[1.15] font-w520 tracking-[-0.03em] text-paper sm:text-[40px]">
              Bring a tutor to your desk.
            </h2>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-caption-muted">
              Tassel is built for macOS, so it can use your Mac's camera and Desk View.
            </p>
            <DownloadButton variant="paper" note className="mt-8" />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
