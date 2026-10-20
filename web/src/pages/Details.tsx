import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Item } from '../lib/types';
import { publishItem, useItemMenu, useLiveItem, useMenuTrigger, useOnItemUpdated } from '../lib/itemMenu';
import { Art, Icon, isRecent, useApi, useAsync, useDetailsLink, useToast } from '../lib/ui';

/** Figma: "MovieDetails / Inside" (118:2845), an 850px overlay above the page it was opened from. */
export default function Details({ hasBackground }: { hasBackground: boolean }) {
  const { id = '' } = useParams();
  const api = useApi();
  const nav = useNavigate();
  const item = useAsync(() => api.item(id), [id]);
  const panel = useRef<HTMLDivElement>(null);
  useOnItemUpdated(id, item.reload); // artwork or watched state changed from a menu

  const close = () => (hasBackground ? nav(-1) : nav('/', { replace: true }));

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Braces matter: an effect must return nothing or a cleanup function, and some browser
  // extensions make scrollTo() return a value, which crashed the page when the panel closed.
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [id]);

  return (
    <div className="details-back" ref={panel} onClick={close}>
      <article className="details" role="dialog" aria-modal="true" aria-label={item.data?.Name ?? 'Details'} onClick={(e) => e.stopPropagation()}>
        <button className="details-close" aria-label="Close" onClick={close}>
          <Icon.close />
        </button>
        {item.error && <p className="err-box">Couldn’t load this title: {item.error}</p>}
        {!item.data && !item.error && <div className="details-hero placeholder" />}
        {item.data && <DetailsBody item={item.data} />}
      </article>
    </div>
  );
}

function DetailsBody({ item }: { item: Item }) {
  const api = useApi();
  const nav = useNavigate();
  const toast = useToast();
  const isSeries = item.Type === 'Series';
  const logo = api.image(item, 'Logo', 700);
  const [logoOk, setLogoOk] = useState(true);
  const fav = !!item.UserData?.IsFavorite;
  const played = !!item.UserData?.Played;

  const seasons = useAsync(() => (isSeries ? api.seasons(item.Id) : Promise.resolve([] as Item[])), [item.Id]);
  const [season, setSeason] = useState<string | null>(null);
  useEffect(() => {
    if (!season && seasons.data?.length) setSeason((seasons.data.find((x) => (x.UserData?.UnplayedItemCount ?? 0) > 0) ?? seasons.data[0]).Id);
  }, [season, seasons.data]);
  const episodes = useAsync(() => (isSeries && season ? api.episodes(item.Id, season) : Promise.resolve([] as Item[])), [item.Id, season]);
  const nextEp = episodes.data?.find((e) => !e.UserData?.Played);
  const similar = useAsync(() => api.similar(item.Id).catch(() => [] as Item[]), [item.Id]);
  const [moreOpen, setMoreOpen] = useState(false);

  const playTarget = isSeries ? nextEp?.Id ?? episodes.data?.[0]?.Id : item.Id;
  const resumable = isSeries ? (nextEp?.UserData?.PlayedPercentage ?? 0) > 0 : (item.UserData?.PlayedPercentage ?? 0) > 0;

  const menu = useItemMenu();
  const heroMenu = useMenuTrigger(item);
  const toggleFav = async () => {
    await api.setFavorite(item.Id, !fav);
    toast(fav ? 'Removed from My List' : 'Added to My List');
    publishItem(await api.item(item.Id));
  };
  const toggleWatched = async () => {
    await api.markPlayed(item.Id, !played);
    toast(played ? 'Marked as unwatched' : 'Marked as watched');
    publishItem(await api.item(item.Id));
  };

  const cast = (item.People ?? []).filter((p) => p.Type === 'Actor');
  const directors = (item.People ?? []).filter((p) => p.Type === 'Director');
  const writers = (item.People ?? []).filter((p) => p.Type === 'Writer');
  const videoHeight = item.MediaStreams?.find((s) => s.Type === 'Video')?.Height ?? item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === 'Video')?.Height;
  const quality = videoHeight ? (videoHeight >= 1600 ? '4K' : videoHeight >= 700 ? 'HD' : null) : null;
  const seasonCount = seasons.data?.length;

  return (
    <>
      <section className="details-hero" {...heroMenu}>
        <Art item={item} kind="Backdrop" width={1280} />
        <div className="details-hero-shade" aria-hidden="true" />
        <div className="details-hero-copy">
          {logo && logoOk ? <img className="details-logo" src={logo} alt={item.Name} onError={() => setLogoOk(false)} /> : <h1 className="details-title">{item.Name}</h1>}
          <div className="details-actions">
            <button className="btn-play" disabled={!playTarget} onClick={() => playTarget && nav(`/play/${playTarget}`)}>
              <Icon.play />
              {resumable ? 'Resume' : 'Play'}
            </button>
            <button className={`circle-btn${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? 'Remove from My List' : 'Add to My List'} title={fav ? 'Remove from My List' : 'Add to My List'} onClick={toggleFav}>
              {fav ? <Icon.check /> : <Icon.plus />}
            </button>
            {!isSeries && (
              <button className={`circle-btn${played ? ' on' : ''}`} aria-pressed={played} aria-label={played ? 'Mark as unwatched' : 'Mark as watched'} title={played ? 'Mark as unwatched' : 'Mark as watched'} onClick={toggleWatched}>
                <Icon.check />
              </button>
            )}
            {api.isAdmin && menu && (
              <button className="circle-btn" aria-label="Edit artwork" title="Edit artwork" onClick={() => menu.editArtwork(item, 'Backdrop')}>
                <Icon.image />
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="details-info">
        <div className="details-main">
          <div className="meta-line">
            {isRecent(item) && <span className="meta-new">New</span>}
            {item.ProductionYear && <span>{item.ProductionYear}</span>}
            {isSeries && seasonCount ? <span>{seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'}</span> : null}
            {!isSeries && item.RunTimeTicks ? <span>{hm(item.RunTimeTicks)}</span> : null}
            {quality && <span className="quality">{quality}</span>}
          </div>
          {item.OfficialRating && (
            <div className="meta-line">
              <span className="rating-box">{item.OfficialRating}</span>
              {item.CommunityRating ? <span className="meta-dim">★ {item.CommunityRating.toFixed(1)}</span> : null}
            </div>
          )}
          {item.Taglines?.[0] && <p className="tagline">{item.Taglines[0]}</p>}
          {item.Overview && <p className="details-overview">{item.Overview}</p>}
        </div>
        <div className="details-side">
          {cast.length > 0 && (
            <p>
              <span className="meta-dim">Cast: </span>
              {cast.slice(0, 3).map((p) => p.Name).join(', ')}
              {cast.length > 3 && <>, <a href="#about" className="more-link">more</a></>}
            </p>
          )}
          {item.Genres?.length ? <p><span className="meta-dim">Genres: </span>{item.Genres.join(', ')}</p> : null}
          {item.Studios?.length ? <p><span className="meta-dim">{isSeries ? 'Network' : 'Studio'}: </span>{item.Studios.slice(0, 2).map((s) => s.Name).join(', ')}</p> : null}
        </div>
      </section>

      {isSeries && (
        <section className="details-section">
          <div className="section-head">
            <h2>Episodes</h2>
            {seasons.data && seasons.data.length > 1 ? (
              <select className="select season-select" aria-label="Season" value={season ?? ''} onChange={(e) => setSeason(e.target.value)}>
                {seasons.data.map((s) => (
                  <option key={s.Id} value={s.Id}>{s.Name}</option>
                ))}
              </select>
            ) : (
              <span className="section-aside">{seasons.data?.[0]?.Name ?? ''}</span>
            )}
          </div>
          <ol className="episode-list">
            {episodes.data?.map((e) => (
              <li key={e.Id}>
                <EpisodeRow e={e} current={e.Id === nextEp?.Id} onPlay={() => nav(`/play/${e.Id}`)} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {similar.data && similar.data.length > 0 && (
        <section className="details-section">
          <div className="section-head"><h2>More Like This</h2></div>
          <div className={`similar-grid${moreOpen ? ' open' : ''}`}>
            {similar.data.slice(0, moreOpen ? 12 : 6).map((s) => <SimilarCard key={s.Id} item={s} />)}
          </div>
          {similar.data.length > 6 && (
            <div className="similar-more">
              <button className={`circle-btn${moreOpen ? ' flip' : ''}`} aria-label={moreOpen ? 'Show fewer' : 'Show more'} onClick={() => setMoreOpen((o) => !o)}>
                <Icon.chevronDown />
              </button>
            </div>
          )}
        </section>
      )}

      <section className="details-section about" id="about">
        <h2>About <strong>{item.Name}</strong></h2>
        {directors.length > 0 && <p><span className="meta-dim">Director: </span>{directors.map((p) => p.Name).join(', ')}</p>}
        {cast.length > 0 && <p><span className="meta-dim">Cast: </span>{cast.slice(0, 15).map((p) => p.Name).join(', ')}</p>}
        {writers.length > 0 && <p><span className="meta-dim">Writer: </span>{writers.map((p) => p.Name).join(', ')}</p>}
        {item.Genres?.length ? <p><span className="meta-dim">Genres: </span>{item.Genres.join(', ')}</p> : null}
        {item.OfficialRating && <p><span className="meta-dim">Maturity rating: </span><span className="rating-box">{item.OfficialRating}</span></p>}
      </section>
    </>
  );
}

function EpisodeRow({ e: given, current, onPlay }: { e: Item; current: boolean; onPlay: () => void }) {
  const e = useLiveItem(given);
  const menu = useMenuTrigger(e);
  return (
    <button className={`episode-row${current ? ' current' : ''}`} onClick={onPlay} {...menu}>
      <span className="ep-num">{e.IndexNumber}</span>
      <span className="ep-thumb">
        <Art item={e} kind="Thumb" width={320} />
        <span className="ep-play" aria-hidden="true"><Icon.play /></span>
        {e.UserData?.PlayedPercentage ? <span className="ep-progress"><span style={{ width: `${e.UserData.PlayedPercentage}%` }} /></span> : null}
        {e.UserData?.Played && <span className="tile-watched" title="Watched"><Icon.check /></span>}
      </span>
      <span className="ep-text">
        <span className="ep-head">
          <span className="ep-title">{e.Name}</span>
          <span className="ep-time">{e.RunTimeTicks ? `${Math.round(e.RunTimeTicks / 6e8)}m` : ''}</span>
        </span>
        {e.Overview && <span className="ep-overview">{e.Overview}</span>}
      </span>
    </button>
  );
}

/** Figma: More Like This card: art with runtime, rating/year/+ row, overview. */
function SimilarCard({ item: given }: { item: Item }) {
  const api = useApi();
  const link = useDetailsLink();
  const item = useLiveItem(given);
  const menu = useMenuTrigger(item);
  const toast = useToast();
  const [fav, setFav] = useState(!!item.UserData?.IsFavorite);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    await api.setFavorite(item.Id, !fav);
    setFav(!fav);
    toast(fav ? 'Removed from My List' : 'Added to My List');
  };
  return (
    <Link className="similar-card" {...link(item)} {...menu} replace>
      <span className="similar-art">
        <Art item={item} kind="Thumb" width={400} />
        {item.RunTimeTicks ? <span className="similar-time">{hm(item.RunTimeTicks)}</span> : null}
        <span className="similar-name">{item.Name}</span>
      </span>
      <span className="similar-meta">
        <span className="similar-tags">
          {item.OfficialRating && <span className="rating-box">{item.OfficialRating}</span>}
          {item.ProductionYear && <span className="meta-dim">{item.ProductionYear}</span>}
        </span>
        <button className={`circle-btn sm${fav ? ' on' : ''}`} aria-label={fav ? 'Remove from My List' : 'Add to My List'} onClick={toggle}>
          {fav ? <Icon.check /> : <Icon.plus />}
        </button>
      </span>
      {item.Overview && <span className="similar-overview">{item.Overview}</span>}
    </Link>
  );
}

function hm(ticks: number): string {
  const m = Math.round(ticks / 6e8);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
