import React from 'react';
import { avatarHtml, avatarPhotoSrc } from './team-mark';

export type AvatarProps = {
  name?: string | null;
  /** Фотография. Пусто, не загрузилась или внешний генератор — остаются инициалы. */
  src?: string | null;
  /** Диаметр в пикселях. */
  size?: number;
};

/** Круг с фотографией человека, а без неё — с инициалами на втором слое стекла. */
export const Avatar: React.FC<AvatarProps> = ({ name, src, size = 40 }) => {
  const photo = avatarPhotoSrc(src);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [photo]);

  if (photo && !failed) {
    return (
      <span style={{ display: 'inline-flex', flex: 'none', width: size, height: size, lineHeight: 0 }}>
        <img
          src={photo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }
  return <span style={{ display: 'inline-flex', flex: 'none', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: avatarHtml(name, size) }} />;
};
