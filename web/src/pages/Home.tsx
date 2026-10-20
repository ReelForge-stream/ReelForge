import { Link, useNavigate } from 'react-router-dom';
import { runtime } from '../lib/api';
import type { Item } from '../lib/types';
import { Art, Card, Icon, epCode, useApi, useAsync, usePoll } from '../lib/ui';

export default function Home() {
  const api = useApi();
  const data = useAsync(async () => {
    const [views, resume, nextUp] = await Promise.all([api.views(), api.resume(), api.nextUp().catch(() => [] as Item[])]);
    const libs = views.filter((v) => v.CollectionType === 'movies' || v.CollectionType === 'tvshows');
    const latest = await Promise.all(libs.map((l) => api.latest(l.Id).then((items) => ({ lib: l, items })).catch(() => ({ lib: l, items: [] as Item[] }))));
    return { resume, nextUp, latest };
  }, []);

  const empty = !!data.data && !data.data.resume.length && !data.data.latest.some((l) => l.items.length);
  usePoll(data.reload, 10000, empty); // libraries still scanning: fill in as titles appear

  if (data.error) return <div className="err-box">Couldn’t load your library: {data.error}</div>;
  if (!data.data) return <div className="loading">Loading…</div>;

  const { resume, nextUp, latest } = data.data;
  const feature = resume[0] ?? latest.find((l) => l.items.length)?.items[0];

  return (
    <>
      {feature ? <Hero item={feature} resuming={resume[0] === feature} /> : <EmptyLibrary />}

      {resume.length > (feature === resume[0] ? 1 : 0) && (
        <Row title="Continue watching">
          <div className="strip wide">
            {resume.slice(feature === resume[0] ? 1 : 0).map((i) => <Card key={i.Id} item={i} shape="thumb" />)}
          </div>
        </Row>
      )}

      {nextUp.length > 0 && (
        <Row title="Next episodes">
          <div className="strip wide">{nextUp.map((i) => <Card key={i.Id} item={i} shape="thumb" />)}</div>
        </Row>
      )}

      {latest.filter((l) => l.items.length).map(({ lib, items }) => (
        <Row key={lib.Id} title={`New in ${lib.Name}`} more={`/library/${lib.Id}`}>
          <div className="strip posters">{items.map((i) => <Card key={i.Id} item={i} />)}</div>
        </Row>
      ))}
    </>
  );
}

function Row({ title, more, children }: { title: string; more?: string; children: React.ReactNode }) {
  return (
    <section className="row">
      <div className="row-head">
        <h2>{title}</h2>
        {more && <Link to={more}>See all</Link>}
      </div>
      {children}
    </section>
  );
}

function Hero({ item, resuming }: { item: Item; resuming: boolean }) {
  const nav = useNavigate();
  const isEp = item.Type === 'Episode';
  const pct = item.UserData?.PlayedPercentage;
  const remaining = item.RunTimeTicks && pct ? item.RunTimeTicks * (1 - pct / 100) : undefined;
  return (
    <section className="hero">
      <div className="backdrop">
        <Art item={item} kind="Backdrop" width={1920} />
      </div>
      <div className="copy">
        <h1 className="title">{isEp ? item.SeriesName : item.Name}</h1>
        <div className="facts">
          {isEp && <span>{epCode(item)} · {item.Name}</span>}
          {!isEp && item.ProductionYear && <span>{item.ProductionYear}</span>}
          {item.OfficialRating && <span>{item.OfficialRating}</span>}
          {item.RunTimeTicks && <span>{runtime(item.RunTimeTicks)}</span>}
          {item.Genres?.slice(0, 2).map((g) => <span key={g}>{g}</span>)}
        </div>
        {item.Overview && <p className="overview">{item.Overview}</p>}
        <div className="actions">
          <button className="btn primary lg" onClick={() => nav(`/play/${item.Id}`)}>
            <Icon.play />
            {resuming && remaining ? `Resume · ${runtime(remaining)} left` : 'Play'}
          </button>
          <button className="btn lg" onClick={() => nav(`/item/${isEp && item.SeriesId ? item.SeriesId : item.Id}`)}>
            Details
          </button>
        </div>
      </div>
    </section>
  );
}

function EmptyLibrary() {
  return (
    <div className="page">
      <div className="empty">
        <h2>Nothing here yet</h2>
        <p className="muted measure">
          If you just added folders, they’re being scanned now. Titles appear here as they’re found; a big library can take a while the first time. No folders yet? Add them in Server settings → Libraries.
        </p>
      </div>
    </div>
  );
}
