import { ButtonLink } from '../components/Button';
import { DownloadButton } from '../components/DownloadButton';
import { Footer } from '../components/Footer';
import { HeroStage } from '../components/HeroStage';
import { Navbar } from '../components/Navbar';
import { TutorLineup } from '../components/TutorLineup';

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
    body: 'She circles the step that goes wrong right on your page, then redraws it on the whiteboard as she explains.',
    tint: 'bg-mint',
  },
  {
    eyebrow: 'Chat',
    title: 'Type it, or snap it',
    body: "Rather type? Ask in the chat beside the stage, or drop in a photo of the page. She'll mark up the image too.",
    tint: 'bg-sky',
  },
  {
    eyebrow: 'Screen share',
    title: 'Stays with you in other apps',
    body: 'Share your screen and Tassel shrinks to a small bar, then draws right over your PDF or problem set.',
    tint: 'bg-rose-mist',
  },
  {
    eyebrow: 'Memory',
    title: 'Remembers where you left off',
    body: 'She keeps track of what you know and what tripped you up, so each session builds on the last.',
    tint: 'bg-seafoam',
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
          <ul className="mt-10 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
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

        <section id="tutor" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="grid gap-10 rounded-hero border border-hairline bg-paper p-6 sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-14">
            <div>
              <p className="mono text-[11px] text-smoke-text">Your tutor</p>
              <h2 className="mt-3 text-balance text-[30px] leading-[1.15] font-w520 tracking-[-0.03em] sm:text-[36px]">
                Make her yours.
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-slate-plum">
                Pick her name, hair, hat, outfit and voice, and tell her how you like to learn. She
                teaches in English, Spanish or Korean, so you can understand why, in your own
                language.
              </p>
              <p className="mono mt-6 text-[11px] text-smoke-text">
                English · <span lang="es">Español</span> · <span lang="ko">한국어</span>
              </p>
            </div>
            <TutorLineup />
          </div>
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
