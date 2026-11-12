import SewerBase from './SewerBase.jsx';
import AvatarWithStatus from './AvatarWithStatus.jsx';
import '../members-art.css';
import '../ambient-rats.css';

const statusLabels = { online: 'Online', away: 'Ausente', dnd: 'Não perturbe', offline: 'Offline' };

export default function MembersPanel({ members = [], effectsEnabled = true }) {
  const sorted = [...members].sort((a, b) => (a.username || '').localeCompare(b.username || '', 'pt-BR'));
  const groups = [
    { title: 'NO ESGOTO', list: sorted.filter((m) => m.status !== 'offline'), offline: false },
    { title: 'LONGE DO ESGOTO', list: sorted.filter((m) => m.status === 'offline'), offline: true },
  ];

  return (
    <aside className="members rr-members" data-fx={effectsEnabled ? 'on' : 'off'} aria-label="Membros">
      <div className="rr-members-pipe" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span className="pipe-segment" key={i} />
        ))}
      </div>
      <div className="rr-members-list">
        {groups.map(({ title, list, offline }) =>
          list.length > 0 && (
            <section key={title}>
              <h3 className="display members-title">
                {title} — {list.length}
              </h3>
              <ul>
                {list.map((member) => (
                  <li
                    key={member.id}
                    className={`member ${offline ? 'is-dim is-offline' : ''}`}
                    title={statusLabels[member.status] || 'Online'}
                  >
                    <AvatarWithStatus user={member} status={member.status} size={30} />
                    <span className="rr-member-name truncate">{member.username}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </div>
      <SewerBase />
    </aside>
  );
}