// Shared acceptance fixtures run against the plain and PxC runtimes so the
// migration cannot silently change game behavior.
export const winFixtures = Object.freeze([
  {
    name: 'horizontal',
    columns: [0, 6, 1, 6, 2, 5, 3],
    winner: 'red',
  },
  {
    name: 'vertical',
    columns: [2, 3, 2, 3, 2, 4, 2],
    winner: 'red',
  },
  {
    name: 'diagonal rising right',
    columns: [0, 1, 1, 2, 2, 3, 2, 3, 4, 3, 3],
    winner: 'red',
  },
  {
    name: 'diagonal falling right',
    columns: [6, 5, 5, 4, 4, 3, 4, 3, 2, 3, 3],
    winner: 'red',
  },
  {
    name: 'horizontal (yellow)',
    columns: [6, 0, 6, 1, 5, 2, 5, 3],
    winner: 'yellow',
  },
  {
    name: 'vertical (yellow)',
    columns: [1, 0, 1, 0, 2, 0, 2, 0],
    winner: 'yellow',
  },
  {
    name: 'diagonal rising right (yellow)',
    columns: [1, 0, 2, 1, 2, 2, 3, 3, 3, 3],
    winner: 'yellow',
  },
  {
    name: 'diagonal falling right (yellow)',
    columns: [5, 6, 4, 5, 4, 4, 3, 3, 3, 3],
    winner: 'yellow',
  },
]);

// A full legal draw: alternating players fill all 42 cells without forming
// four. The last move is a legal draw, not a synthetic board-state shortcut.
export const drawColumns = Object.freeze([
  3, 4, 4, 6, 4, 1, 6, 4, 6, 3, 5, 6, 6, 5, 3, 3, 3, 2, 2, 3, 6,
  2, 1, 5, 1, 4, 5, 4, 5, 2, 1, 0, 5, 0, 0, 0, 0, 2, 0, 1, 2, 1,
]);

export function dropEvents(columns) {
  return columns.map(column => ({ type: 'drop', column }));
}
