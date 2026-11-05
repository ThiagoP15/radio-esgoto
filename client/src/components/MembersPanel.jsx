import { COPY } from '../copy.js';
import AvatarWithStatus from './AvatarWithStatus.jsx';
import { STATUS_LABEL } from './StatusBadge.jsx';

function Section({ title, list, dim }) {
  if (list.length === 0) return null;
  return (
    <section>
      <h3 className="display members-title">
        {title} — {list.length}
      </h3>
      <ul>
        {list.map((member) => (
          <li key={member.id} title={STATUS_LABEL[member.status]} className={`member ${dim ? 'is-dim' : ''}`}>
            <AvatarWithStatus user={member} status={member.status} size={30} />
            <span className="truncate">{member.username}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MembersPanel({ members }) {
  const sorted = [...members].sort((a, b) => a.username.localeCompare(b.username, 'pt-BR'));
  return (
    <aside className="members" aria-label="Membros">
      <Section title={COPY.membersOnline} list={sorted.filter((m) => m.status !== 'offline')} />
      <Section title={COPY.membersOffline} list={sorted.filter((m) => m.status === 'offline')} dim />
    </aside>
  );
}
