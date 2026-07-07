/**
 * Faithful recreations of the five Sprout budtender-app screens shown inside
 * the marketing phone frames. Ported from the prototype's `phones.jsx` +
 * `phones.css`, re-expressed against our design-system tokens.
 *
 * The phone shell, status bar and tab bar are shared primitives
 * (`./phone`). The dense screen internals — balance cards, conic rings,
 * podiums, chat bubbles, gradient thumbs, progress tracks — live in the
 * co-located `screens.css`, where the prototype class names are preserved
 * but scoped under `.sprout-screen`. Every colour in that stylesheet is a
 * design-system token via CSS var; there are no raw hexes.
 *
 * Dark screens (Home / Community / Live) set `data-theme="dark"` on the
 * `.sprout-screen` wrapper so the theme-flipping selectors resolve, matching
 * the `data-theme="dark"` the `Phone` shell already applies for the canvas.
 */
import "./screens.css";

import { Phone, StatusBar, TabBar } from "./phone";
import {
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  FlaskConical,
  Leaf,
  Play,
  Send,
  ShieldCheck,
  Video,
  Zap,
} from "./icons";

/* ── small avatar tile ───────────────────────────────────── */
function Av({
  children,
  bg,
  className = "av",
}: {
  children: React.ReactNode;
  bg: string;
  className?: string;
}) {
  return (
    <div className={className} style={{ background: bg }}>
      {children}
    </div>
  );
}

/* ──────────────────────── HOME / DASHBOARD ──────────────────────── */
export function ScreenHome() {
  return (
    <Phone dark>
      <StatusBar dark />
      <div className="sprout-screen" data-theme="dark">
        <div className="scr-pad">
          <div className="flex items-start justify-between">
            <div>
              <div className="ap-over">Good morning</div>
              <h1 className="ap-h1 mt-1.5">Jordan</h1>
            </div>
            <div className="grid size-[38px] place-items-center rounded-full bg-success-bg text-growth-green">
              <Bell size={18} />
            </div>
          </div>

          <div className="bal-row mt-4">
            <div className="bal">
              <div className="bl-lbl">Your balance</div>
              <div className="bl-num">4,310</div>
              <div className="bl-unit">Sprout points</div>
            </div>
            <div className="streak">
              <div className="ring">
                <div className="ring-in">12</div>
              </div>
              <div className="st-lbl">12-day streak</div>
            </div>
          </div>

          <div className="acard mt-3">
            <div className="goal">
              <div>
                <div className="g-t">Daily goal</div>
                <div className="g-s">2 of 3 lessons done</div>
              </div>
              <span className="pts inline-flex items-center gap-1 text-[10px]">
                <Zap size={11} />
                +50 today
              </span>
            </div>
            <div className="track">
              <i style={{ width: "66%" }} />
            </div>
          </div>

          <div className="sec-lbl">
            <span className="sl-t">Fresh for you</span>
            <span className="sl-a">See all</span>
          </div>
          <div className="acard">
            <div className="lesson">
              <div className="thumb tg1">
                <FlaskConical size={24} />
              </div>
              <div className="flex-1">
                <div className="l-over">Terpenes · 5 min</div>
                <div className="l-t">What are terpenes?</div>
                <div className="l-meta">
                  <span className="pts">+150 pts</span>
                  <span className="done">
                    <CheckCircle2 size={11} />
                    Done
                  </span>
                </div>
              </div>
            </div>
            <div className="lesson">
              <div className="thumb tg2">
                <Leaf size={24} />
              </div>
              <div className="flex-1">
                <div className="l-over">Strains · 4 min</div>
                <div className="l-t">Indica vs Sativa vs Hybrid</div>
                <div className="l-meta">
                  <span className="pts">+120 pts</span>
                  <span className="done">
                    <CheckCircle2 size={11} />
                    Done
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div
            className="bal mt-3"
            style={{
              background:
                "linear-gradient(150deg, var(--color-forest-800), var(--color-forest-950))",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="bl-lbl">Store leaderboard</div>
              <span className="font-body text-[10px] font-semibold leading-none text-sprout-green">
                #2 this month
              </span>
            </div>
            <div className="mt-[11px] flex items-center gap-[9px]">
              <Av bg="var(--color-growth-500)">MC</Av>
              <span className="flex-1 font-body text-[12px] font-semibold leading-none text-cream">
                Maya Chen
              </span>
              <span className="font-body text-[12px] font-bold leading-none text-sprout-green">
                4,820
              </span>
            </div>
          </div>
        </div>
      </div>
      <TabBar active="Home" />
    </Phone>
  );
}

/* ──────────────────────────── LEARN ─────────────────────────────── */
const LEARN_LESSONS = [
  {
    tg: "tg1",
    Icon: FlaskConical,
    over: "Terpenes · 5 min",
    title: "What are terpenes?",
    pts: "+150 pts",
    done: true,
  },
  {
    tg: "tg2",
    Icon: Leaf,
    over: "Strains · 4 min",
    title: "Indica vs Sativa vs Hybrid",
    pts: "+120 pts",
    done: true,
  },
  {
    tg: "tg3",
    Icon: ShieldCheck,
    over: "Compliance · 7 min",
    title: "Reading a COA",
    pts: "+200 pts",
    done: false,
  },
  {
    tg: "tg4",
    Icon: BookOpen,
    over: "Brand · 3 min",
    title: "The Highland Harvest story",
    pts: "+100 pts",
    done: false,
  },
] as const;

export function ScreenLearn() {
  return (
    <Phone>
      <StatusBar />
      <div className="sprout-screen">
        <div className="scr-pad">
          <h1 className="ap-h1">Learn</h1>
          <div className="ap-sub">Master the products you sell.</div>
          <div className="chips">
            <span className="fchip on">All</span>
            <span className="fchip">Terpenes</span>
            <span className="fchip">Strains</span>
            <span className="fchip">Compliance</span>
          </div>

          <div className="acard mt-3.5">
            <div className="prog">
              <div className="pring">
                <i>70%</i>
              </div>
              <div className="flex-1">
                <div className="p-t">Terpenes 101</div>
                <div className="p-s">7 of 10 lessons · keep going</div>
              </div>
              <ChevronRight size={18} className="text-forest-500" />
            </div>
          </div>

          <div className="mt-3 grid gap-2.5">
            {LEARN_LESSONS.map(({ tg, Icon, over, title, pts, done }) => (
              <div className="acard" key={title}>
                <div className="lesson">
                  <div className={`thumb ${tg}`}>
                    <Icon size={24} />
                  </div>
                  <div className="flex-1">
                    <div className="l-over">{over}</div>
                    <div className="l-t">{title}</div>
                    <div className="l-meta">
                      <span className="pts">{pts}</span>
                      {done ? (
                        <span className="done">
                          <CheckCircle2 size={11} />
                          Done
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <TabBar active="Learn" />
    </Phone>
  );
}

/* ──────────────────────────── RANKS ─────────────────────────────── */
type RankRow = {
  rk: number;
  in_: string;
  nm: string;
  pts: string;
  bg: string;
  me?: boolean;
};

const RANK_ROWS: readonly RankRow[] = [
  { rk: 1, in_: "MC", nm: "Maya Chen", pts: "4,820", bg: "var(--color-growth-500)" },
  { rk: 2, in_: "Y", nm: "You", pts: "4,310", bg: "var(--color-forest-700)", me: true },
  { rk: 3, in_: "DP", nm: "Devon Park", pts: "3,990", bg: "var(--color-purple-haze)" },
  { rk: 4, in_: "SR", nm: "Sam Rivera", pts: "3,540", bg: "var(--color-growth-400)" },
  { rk: 5, in_: "AK", nm: "Aisha Khan", pts: "3,120", bg: "var(--color-stigma)" },
  { rk: 6, in_: "LM", nm: "Leo Martin", pts: "2,870", bg: "var(--color-forest-500)" },
];

export function ScreenRanks() {
  return (
    <Phone>
      <StatusBar />
      <div className="sprout-screen">
        <div className="scr-pad">
          <h1 className="ap-h1">Ranks</h1>
          <div className="chips mt-3">
            <span className="fchip on">My store</span>
            <span className="fchip">Region</span>
            <span className="fchip">All LPs</span>
          </div>

          <div className="podium mt-4">
            <div className="pod p2">
              <Av bg="var(--color-forest-700)">Y</Av>
              <span className="nm">You</span>
              <div className="bar">2</div>
            </div>
            <div className="pod p1">
              <Av bg="var(--color-growth-500)">MC</Av>
              <span className="nm">Maya</span>
              <div className="bar">1</div>
            </div>
            <div className="pod p3">
              <Av bg="var(--color-purple-haze)">DP</Av>
              <span className="nm">Devon</span>
              <div className="bar">3</div>
            </div>
          </div>

          <div className="acard py-1">
            {RANK_ROWS.map(({ rk, in_, nm, pts, bg, me }) => (
              <div className={`rrow${me ? " me" : ""}`} key={nm}>
                <span className="rk">{rk}</span>
                <Av bg={bg}>{in_}</Av>
                <span className="rn">{nm}</span>
                <span className="rp">{pts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <TabBar active="Ranks" />
    </Phone>
  );
}

/* ─────────────────────── COMMUNITY / CHAT ───────────────────────── */
export function ScreenCommunity() {
  return (
    <Phone dark>
      <StatusBar dark />
      <div className="sprout-screen" data-theme="dark">
        <div className="scr-pad" style={{ paddingBottom: 76 }}>
          <h1 className="ap-h1">Community</h1>
          <div className="ap-sub">Highland Harvest · brand channel</div>

          <div className="msg">
            <Av bg="var(--color-purple-haze)" className="mav">
              DP
            </Av>
            <div className="bub">
              <div className="mn">Devon P.</div>
              <div className="mt">
                Anyone tried the new Pink Kush drop? Customers keep asking how it compares to our
                OG.
              </div>
            </div>
          </div>
          <div className="msg">
            <Av bg="var(--color-sprout-green)" className="mav">
              HH
            </Av>
            <div className="bub">
              <div className="mn">
                Highland Harvest <span className="role">Brand</span>
              </div>
              <div className="mt">
                Great question 🌱 Pink Kush leans higher in myrcene — calmer, more relaxing. We just
                dropped a 4-min lesson on it.
              </div>
            </div>
          </div>
          <div className="msg me">
            <Av bg="var(--color-forest-600)" className="mav">
              Y
            </Av>
            <div className="bub">
              <div className="mt">
                Just finished it — the terpene breakdown is super helpful for the floor.
              </div>
            </div>
          </div>
          <div className="msg">
            <Av bg="var(--color-stigma)" className="mav">
              AK
            </Av>
            <div className="bub">
              <div className="mn">Aisha K.</div>
              <div className="mt">Same. Sold three today off that one talk track 👏</div>
            </div>
          </div>
        </div>
        <div className="chat-input">
          <span className="ph">Message #highland-harvest…</span>
          <div className="send">
            <Send size={16} />
          </div>
        </div>
      </div>
    </Phone>
  );
}

/* ─────────────────────────── LIVE / MEDIA ───────────────────────── */
export function ScreenLive() {
  return (
    <Phone dark>
      <StatusBar dark />
      <div className="sprout-screen" data-theme="dark">
        <div className="scr-pad">
          <h1 className="ap-h1">Live</h1>
          <div className="ap-sub">Watch, learn, ask the grower.</div>

          <div className="live-hero mt-3.5">
            <span className="live-badge">
              <span className="blip" />
              LIVE
            </span>
            <span className="live-views">
              <Eye size={12} />
              312
            </span>
            <div className="play">
              <Play size={22} />
            </div>
          </div>
          <div className="live-title">Inside the grow: this season&apos;s harvest</div>
          <div className="live-host">
            <div className="lav">HH</div>
            <div>
              <div className="lh-n">Highland Harvest</div>
              <div className="lh-r">Master Grower · Q&amp;A</div>
            </div>
          </div>

          <div className="sec-lbl mt-4">
            <span className="sl-t" style={{ color: "var(--color-cream)" }}>
              Replays
            </span>
            <span className="sl-a">See all</span>
          </div>
          <div className="vod">
            <div className="v">
              <div className="vthumb tg3">
                <Video size={18} />
              </div>
              <div className="vt">Terpene deep-dive with the lab team</div>
            </div>
            <div className="v">
              <div
                className="vthumb"
                style={{
                  background:
                    "linear-gradient(150deg, var(--color-purple-haze), var(--color-plum-kush))",
                }}
              >
                <Video size={18} />
              </div>
              <div className="vt">New drop walkthrough: spring lineup</div>
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}
