import React from 'react';
import { UI, useUiMount } from './uikit';

export type FeedType = {
  icon?: string;
  tone?: 'blue' | 'violet' | 'green' | 'yellow' | 'red';
  label?: string;
  plural?: [string, string, string];
  verb?: [string, string, string];
};

export type FeedItem = {
  id: string | number;
  type: string;
  /** ISO-время события. */
  at: string;
  title?: string;
  sub?: string;
  amount?: number;
  href?: string;
  /** HTML вместо значка типа: знак команды, аватар. Только разметка продукта, не текст человека. */
  lead?: string;
  /** Отметка справа под временем: «иду», «не иду». */
  status?: { text: string; tone?: 'success' | 'muted'; icon?: string };
  /** Кнопки под строкой: «Принять», «Отклонить». */
  actions?: { label: string; primary?: boolean; onClick: () => void }[];
  /** Готовая строка времени вместо относительной («ср 19:00»). */
  timeDisplay?: string;
};

export type FeedProps = {
  title?: string;
  sub?: string;
  types: Record<string, FeedType>;
  items: FeedItem[];
  limit?: number;
  /** `asc` — ближайшие сверху, `given` — как переданы. По умолчанию свежие сверху. */
  order?: 'desc' | 'asc' | 'given';
  /** false — не сворачивать пачки однотипных событий. */
  group?: false | { windowSec: number };
  more?: { label: string; onClick: () => void };
  empty?: { text: string };
};

export const mountFeed = (el: HTMLElement, c: Record<string, unknown>) => UI.feed.mount(el, { group: false, limit: 50, ...c });

/** Лента событий ui-kit (`UI.feed`). Данные приходят целиком, лента перерисовывается при смене пропсов.
 *  Пачки не сворачиваются (`group: false`) и лимит 50, пока экран не скажет иначе. */
export const Feed: React.FC<FeedProps> = (props) => {
  const cfg = React.useMemo<Record<string, unknown>>(() => ({ ...props }), [props.title, props.sub, props.types, props.items, props.limit, props.order, props.group, props.more, props.empty]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useUiMount(mountFeed, cfg);
  return <div ref={ref} />;
};
