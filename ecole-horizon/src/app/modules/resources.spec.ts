import { domainOf, livePhase, mapResource } from './resources';

describe('Supports de cours', () => {
  it('traduit une réponse du serveur', () => {
    const r = mapResource({ id: 3, school_class: 2, subject: 9, subject_name: 'Maths', teacher_name: 'M. Koffi', kind: 'direct', title: 'Révisions', description: '',
      links: [{ url: 'https://meet.google.com/abc', label: 'Salle' }], links_hidden: false, has_file: false, file_name: '', starts_at: '2026-10-10T10:00:00Z', ends_at: '2026-10-10T11:00:00Z', created_at: '2026-10-09T08:00:00Z' },
      (pk) => (pk === 9 ? 'MATH' : undefined));
    expect(r.id).toBe('3');
    expect(r.subjectId).toBe('MATH');
    expect(r.links[0].label).toBe('Salle');
    expect(r.linksHidden).toBe(false);
  });
  it('affiche le site sans www', () => {
    expect(domainOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(domainOf('pas une adresse')).toBe('');
  });
  it('situe un cours en direct dans le temps', () => {
    const r = { startsAt: '2026-10-10T10:00:00Z', endsAt: '2026-10-10T11:00:00Z' };
    expect(livePhase(r, Date.parse('2026-10-10T09:00:00Z'))).toBe('a_venir');
    expect(livePhase(r, Date.parse('2026-10-10T10:30:00Z'))).toBe('en_cours');
    expect(livePhase(r, Date.parse('2026-10-10T12:00:00Z'))).toBe('termine');
  });
});
