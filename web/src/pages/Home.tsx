import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Item } from '../lib/types';
import { useLiveItem, useMenuTrigger } from '../lib/itemMenu';
import { Art, Icon, RankTile, Tile, epCode, useApi, useAsync, useDetailsLink, usePoll } from '../lib/ui';

const PREFERRED_GENRES = ['Action', 'Comedy', 'Drama', 'Animation', 'Thriller', 'Science Fiction', 'Family', 'Documentary', 'Crime', 'Horror', 'Adventure', 'Romance'];

export default function Home() {
  const api = useApi();
  const data = useAsync(async () => {
    const [views, resume, nextUp] = await Promise.all([api.views(), api.resume(), api.nextUp().catch(() => [] as Item[])]);
    const libs = views.filter((v) => v.CollectionType === 'movies' || v.CollectionType === 'tvshows');
    const latest = await Promise.all(libs.map((l) => api.latest(l.Id).then((items) => ({ lib: l, items })).catch(() => ({ lib: l, items: [] as Item[] }))));
    const movieLib = libs.find((l) => l.CollectionType === 'movies');
    const top = movieLib
      ? await api.items({ parentId: movieLib.Id, types: 'Movie', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending', limit: 10 }).then((r) => r.Items.filter((i) => i.CommunityRating)).catch(() => [] as Item[])
      : [];
    const allGenres = await api.genres().catch(() => []);
    const names = PREFERRED_GENRES.filter((g) => allGenres.some((x) => x.Name === g)).slice(0, 4);
    const genres = await Promise.all(
      names.map((g) => api.items({ genre: g, types: 'Movie,Series', sortBy: 'Random', limit: 18 }).then((r) => ({ name: g, items: r.Items })).catch(() => ({ name: g, items: [] as Item[] }))),
    );
    return { resume, nextUp, latest, top, genres: genres.filter((g) => g.items.length >= 4) };
  }, []);

  const empty = !!data.data && !data.data.resume.length && !data.data.latest.some((l) => l.items.length);
  usePoll(data.reload, 10000, empty); // libraries still scanning: fill in as titles appear

  // The billboard features something recent with good artwork, picked once per visit.
  const feature = useMemo(() => {
    if (!data.data) return undefined;
    const pool = data.data.latest.flatMap((l) => l.items).filter((i) => i.BackdropImageTags?.length || i._hue != null);
    return pool.length ? pool[Math.floor(Math.random() * Math.min(pool.length, 8))] : data.data.resume[0];
  }, [data.data]);

  if (data.error) return <div className="err-box">Couldn’t load your library: {data.error}</div>;
  if (!data.data) return <div className="loading">Loading…</div>;
  const { resume, nextUp, latest, top, genres } = data.data;

  return (
    <div className="home">
      {feature ? <Billboard item={feature} /> : <EmptyLibrary />}
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
