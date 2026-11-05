import Avatar from './Avatar.jsx';
import StatusBadge from './StatusBadge.jsx';

export default function AvatarWithStatus({ user, status, size = 32 }) {
  const badge = Math.max(12, Math.round(size * 0.4));
  return (
    <span className="avatar-status">
      <Avatar name={user.username} src={user.avatar_url} size={size} />
      <span className="lamp-cutout">
        <StatusBadge status={status} size={badge} />
      </span>
    </span>
  );
}
