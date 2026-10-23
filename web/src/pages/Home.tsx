import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Item } from '../lib/types';
import { useLiveItem, useMenuTrigger } from '../lib/itemMenu';
import { Art, Icon, RankTile, Tile, epCode, useApi, useDetailsLink, usePoll } from '../lib/ui';

const PREFERRED_GENRES = ['Action', 'Comedy', 'Drama', 'Animation', 'Thriller', 'Science Fiction', 'Family', 'Documentary', 'Crime', 'Horror', 'Adventure', 'Romance'];

interface HomeData {
  resume: Item[];
  nextUp: Item[];
  latest: { lib: Item; items: Item[] }[];
  top: Item[];
  spotlight: Item[];
  genres: { name: string; items: Item[] }[];
}

const cacheKey = (userId: string) => `rf-home-${userId}`;

function readCache(userId: string): Partial<HomeData> | null {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(userId)) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Everything Home shows, loaded all at once and shown row by row as each arrives. The last Home
 * is remembered, so it appears instantly next time while fresh rows load in behind it.
 */
function useHomeData() {
  const api = useApi();
  const [d, setD] = useState<Partial<HomeData>>(() => readCache(api.userId) ?? {});
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    const fresh: Partial<HomeData> = {};
    const put = <K extends keyof HomeData>(k: K, v: HomeData[K]) => {
      if (!live) return;
      fresh[k] = v;
      setD((x) => ({ ...x, [k]: v }));
    };
    const light = { count: false } as const;
    const none: Item[] = [];
    const jobs: Promise<unknown>[] = [
      api.resume().then((v) => put('resume', v)),
      api.nextUp().catch(() => none).then((v) => put('nextUp', v)),
      api.items({ ...light, types: 'Movie,Series', sortBy: 'Random', limit: 24, withImage: 'Backdrop' }).then((r) => put('spotlight', r.Items)).catch(() => put('spotlight', none)),
      // Genre rows: ask for a handful of common genres directly instead of listing every genre first.
      Promise.all(
        PREFERRED_GENRES.slice(0, 7).map((g) =>
          api.items({ ...light, genre: g, types: 'Movie,Series', sortBy: 'Random', limit: 18 }).then((r) => ({ name: g, items: r.Items })).catch(() => ({ name: g, items: none })),
        ),
      ).then((gs) => put('genres', gs.filter((g) => g.items.length >= 4).slice(0, 4))),
      api.views().then((views) => {
        const libs = views.filter((v) => v.CollectionType === 'movies' || v.CollectionType === 'tvshows');
        const movieLib = libs.find((l) => l.CollectionType === 'movies');
        return Promise.all([
          Promise.all(libs.map((l) => api.latest(l.Id).then((items) => ({ lib: l, items })).catch(() => ({ lib: l, items: none })))).then((v) => put('latest', v)),
          movieLib
            ? api.items({ ...light, parentId: movieLib.Id, types: 'Movie', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending', limit: 10 }).then((r) => put('top', r.Items.filter((i) => i.CommunityRating))).catch(() => put('top', none))
            : put('top', none),
        ]);
      }),
    ];
    Promise.all(jobs)
      .then(() => {
        if (!live) return;
        setError(null);
        try {
          localStorage.setItem(cacheKey(api.userId), JSON.stringify(fresh));
        } catch {
          /* full or private mode: no cache, still works */
        }
      })
      .catch((e: Error) => live && !Object.keys(fresh).length && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, round]);

  return { d, error, reload: () => setRound((n) => n + 1) };
}

export default function Home() {
  const api = useApi();
  const { d, error, reload } = useHomeData();
  const ready = d.resume !== undefined && d.latest !== undefined;
  const empty = ready && !d.resume!.length && !d.latest!.some((l) => l.items.length);
  usePoll(reload, 10000, empty); // libraries still scanning: fill in as titles appear

  // The billboard rotates through up to 20 titles. Picked once per visit, so it doesn't reshuffle while rows load.
  const [featured, setFeatured] = useState<Item[]>([]);
  useEffect(() => {
    if (!featured.length && d.spotlight && d.latest) setFeatured(featuredPool({ latest: d.latest, spotlight: d.spotlight }));
  }, [d.spotlight, d.latest, featured.length]);

  if (error && !ready) return <div className="err-box">Couldn’t load your library: {error}</div>;
  const resume = d.resume ?? [];
  const nextUp = d.nextUp ?? [];
  const latest = d.latest ?? [];
  const top = d.top ?? [];
  const genres = d.genres ?? [];

  return (
    <div className="home">
      {featured.length ? <Rotator items={featured} /> : resume[0] ? <Billboard item={resume[0]} /> : empty ? <EmptyLibrary /> : <div className="billboard billboard-wait" aria-hidden="true" />}
      <div className="rows">
        {resume.length > 0 && (
          <Row title={`Continue Watching for ${api.session.user.Name}`}>
            {resume.map((i) => <Tile key={i.Id} item={i} />)}
          </Row>
        )}
        {nextUp.length > 0 && <Row title="Next Episodes">{nextUp.map((i) => <Tile key={i.Id} item={i} />)}</Row>}
        {latest.filter((l) => l.items.length).map(({ lib, items }) => (
          <Row key={lib.Id} title={`New in ${lib.Name}`} more={`/library/${lib.Id}`}>
            {items.map((i) => <Tile key={i.Id} item={i} />)}
          </Row>
        ))}
        {top.length >= 5 && (
          <Row title="Top 10 Movies on Your Server" ranked>
            {top.slice(0, 10).map((i, n) => <RankTile key={i.Id} item={i} rank={n + 1} />)}
          </Row>
        )}
        {genres.map((g) => (
          <Row key={g.name} title={g.name}>
            {g.items.map((i) => <Tile key={i.Id} item={i} />)}
          </Row>
        ))}
      </div>
    </div>
  );
}

/** Figma: MovieBlock (106:9064): title, then a strip of 16:9 tiles with paging arrows. */
function Row({ title, more, ranked, children }: { title: string; more?: string; ranked?: boolean; children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = strip.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
  }, [children]);
  const page = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.9, behavior: 'smooth' });

  return (
    <section className={`mrow${ranked ? ' ranked' : ''}`}>
      <h2 className="mrow-title">
        {more ? <Link to={more}>{title}<span className="mrow-more">Explore all <Icon.chevronDown /></span></Link> : title}
      </h2>
      <div className="mrow-viewport">
        {!edges.start && (
          <button className="mrow-arrow left" aria-label="Previous" onClick={() => page(-1)}>
            <Icon.back />
          </button>
        )}
        <div className="mrow-strip" ref={strip} onScroll={update}>
          {children}
        </div>
        {!edges.end && (
          <button className="mrow-arrow right" aria-label="Next" onClick={() => page(1)}>
            <Icon.back />
          </button>
        )}
      </div>
    </section>
  );
}

const hasArt = (i: Item) => !!i.BackdropImageTags?.length || i._hue != null;

/** Up to 20 featured titles: a few newest arrivals, then a shuffle of the rest. Picked once per visit. */
function featuredPool(d?: { latest: { items: Item[] }[]; spotlight: Item[] }): Item[] {
  if (!d) return [];
  const seen = new Set<string>();
  const out: Item[] = [];
  const add = (i: Item) => {
    // Episodes in "latest" stand in for their show; the billboard features the show itself.
    if (!hasArt(i) || i.Type === 'Episode' || seen.has(i.Id)) return;
    seen.add(i.Id);
    out.push(i);
  };
  const fresh = d.latest.flatMap((l) => l.items.slice(0, 3));
  fresh.forEach(add);
  const rest = [...d.spotlight, ...d.latest.flatMap((l) => l.items.slice(3))];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  rest.forEach(add);
  return out.slice(0, 20);
}

const ROTATE_MS = 9000;

/** Cycles the billboard every few seconds; pauses while you point at it, use it, or the tab is hidden. */
function Rotator({ items }: { items: Item[] }) {
  const api = useApi();
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const [tick, setTick] = useState(0);
  const touch = useRef<number | null>(null);
  const n = items.length;
  const go = (i: number) => setAt(((i % n) + n) % n);

  useEffect(() => {
    if (n < 2 || held) return;
    const t = window.setTimeout(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('.item-menu, .dialog-back')) go(at + 1);
      else setTick((x) => x + 1); // busy right now: try again next round
    }, ROTATE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, held, n, tick]);

  // Warm up the next picture so the change is instant.
  useEffect(() => {
    const next = items[(at + 1) % n];
    const url = next && api.image(next, 'Backdrop', 1920);
    if (url) new Image().src = url;
  }, [api, at, items, n]);

  return (
    <div
      className="rotator"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHeld(false)}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX);
        if (Math.abs(dx) > 50) go(at + (dx < 0 ? 1 : -1));
        touch.current = null;
      }}
      aria-roledescription="carousel"
      aria-label="Featured"
    >
      <Billboard key={items[at].Id} item={items[at]} />
      {n > 1 && (
        <>
          <button className="rot-arrow left" aria-label="Previous featured title" onClick={() => go(at - 1)}><Icon.back /></button>
          <button className="rot-arrow right" aria-label="Next featured title" onClick={() => go(at + 1)}><Icon.back /></button>
          <div className="rot-dots" role="tablist" aria-label="Featured titles">
            {items.map((it, i) => (
              <button key={it.Id} role="tab" aria-selected={i === at} aria-label={`${i + 1} of ${n}: ${it.Name}`} className={i === at ? `on${held ? '' : ' run'}` : ''} onClick={() => go(i)}>
                <span style={{ animationDuration: `${ROTATE_MS}ms` }} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Figma: Hero image + TitlePreview (99:3471) + Rating flag (106:3708). */
function Billboard({ item: given }: { item: Item }) {
  const api = useApi();
  const item = useLiveItem(given);
  const menu = useMenuTrigger(item);
  const nav = useNavigate();
  const link = useDetailsLink();
  const isEp = item.Type === 'Episode';
  const logo = api.image(item, 'Logo', 1000);
  const [logoOk, setLogoOk] = useState(true);
  const resumable = (item.UserData?.PlayedPercentage ?? 0) > 0;
  const title = isEp ? item.SeriesName ?? item.Name : item.Name;

  return (
    <section className="billboard" {...menu}>
      <div className="billboard-art">
        <Art item={item} kind="Backdrop" width={1920} />
      </div>
      <div className="billboard-shade" aria-hidden="true" />
      <div className="billboard-copy">
        {logo && logoOk ? (
          <img className="billboard-logo" src={logo} alt={title} onError={() => setLogoOk(false)} />
        ) : (
          <h1 className="billboard-title">{title}</h1>
        )}
        {isEp && <p className="billboard-ep">{epCode(item)} · {item.Name}</p>}
        {item.Overview && <p className="billboard-overview">{item.Overview}</p>}
        <div className="billboard-actions">
          <button className="btn-play" onClick={() => nav(`/play/${item.Id}`)}>
            <Icon.play />
            {resumable ? 'Resume' : 'Play'}
          </button>
          <Link className="btn-more" {...link(isEp && item.SeriesId ? { ...item, Id: item.SeriesId, Type: 'Series' } : item)}>
            <Icon.info />
            More Info
          </Link>
        </div>
      </div>
      {item.OfficialRating && <span className="rating-flag">{item.OfficialRating}</span>}
    </section>
  );
}

function EmptyLibrary() {
  return (
    <div className="page empty-home">
      <div className="empty">
        <h2>Nothing here yet</h2>
        <p className="muted measure">
          If you just added folders, they’re being scanned now. Titles appear here as they’re found; a big library can take a while the first time. No folders yet? Add them in Server settings → Libraries.
        </p>
      </div>
    </div>
  );
}
