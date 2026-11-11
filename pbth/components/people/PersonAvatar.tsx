import React from 'react';
import { Avatar } from '../../ui';
import { initialsOf } from '../../ui';

// Аватар человека: фото, а если его нет или оно не загрузилось, — инициалы.
// Локальная обёртка: `Avatar` из pbth/ui фото не умеет (предложено в основу).
// Внешний сервис картинок с инициалами не используется.

export const PersonAvatar: React.FC<{ name?: string | null; photo?: string | null; size?: number }> = ({
  name,
  photo,
  size = 40,
}) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [photo]);

  if (photo && !failed) {
    return (
      <img
        className="pbth-person"
        src={photo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
      />
    );
  }
  if (size > 56) {
    return (
      <span
        className="ui-glass2 pbth-person pbth-person--big"
        role="img"
        aria-label={name ?? ''}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      >
        {initialsOf(name)}
      </span>
    );
  }
  return <Avatar name={name} size={size} />;
};
