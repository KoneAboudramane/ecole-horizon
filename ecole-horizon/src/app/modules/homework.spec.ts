import { describe, expect, it } from 'vitest';
import { ApiHomework, mapHomework, mapMine, mmss, toInput } from './homework';

const api = (o: Partial<ApiHomework> = {}): ApiHomework => ({
  id: 7, school_class: 3, subject: 11, subject_name: 'Mathématiques', teacher_name: 'M. Koné', kind: 'epreuve', title: 'Fractions', instructions: '',
  opens_at: '2026-10-12T08:00:00Z', due_at: '2026-10-12T18:00:00Z', allow_late: true, max_points: 20, duration_min: 30, shuffle: true, correction: 'fin',
  correction_open: false, max_leaves: 3, published: true, has_attachment: false, attachment_name: '', question_count: 3, total_points: 5, window: 'ouvert', evaluation: null, ...o,
});

describe('devoirs : correspondance serveur → interface', () => {
  it('relie la matière à son code et convertit les identifiants en texte', () => {
    const h = mapHomework(api(), (pk) => (pk === 11 ? 'ma' : undefined));
    expect(h.id).toBe('7'); expect(h.classId).toBe('3'); expect(h.subjectId).toBe('ma'); expect(h.mine).toEqual([]); expect(h.correctionVisible).toBe(false);
  });
  it('garde les copies de l’élève et du parent avec des identifiants texte', () => {
    const m = mapMine({ id: 4, student: 9, status: 'termine', late: false, manual: false, leaves: 2, submitted_at: null, started_at: 'a', finished_at: 'b', deadline_at: 'c', score: 3.5, feedback: '', file_name: '', comment: '', graded: true });
    expect(m.student).toBe('9'); expect(m.leaves).toBe(2); expect(m.score).toBe(3.5); expect(m.graded).toBe(true);
  });
});

describe('devoirs : chronomètre et dates', () => {
  it('affiche le temps restant', () => {
    expect(mmss(0)).toBe('0:00'); expect(mmss(65)).toBe('1:05'); expect(mmss(1800)).toBe('30:00'); expect(mmss(3725)).toBe('1:02:05'); expect(mmss(-4)).toBe('0:00');
  });
  it('prépare la valeur d’un champ date et heure', () => {
    expect(toInput('2026-10-12T18:30:00')).toBe('2026-10-12T18:30');
  });
});
