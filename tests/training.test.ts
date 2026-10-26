import { COURSES, GLOSSARY, LESSONS } from "../src/ui/training/lessons";

describe("training lessons", () => {
  it("have unique ids, a known course and steps", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(COURSES).toContain(l.course);
      expect(l.steps.length).toBeGreaterThan(3);
      expect(l.learn.length).toBeGreaterThan(0);
    }
    expect(COURSES.every((c) => LESSONS.some((l) => l.course === c))).toBe(true);
  });
  it("quiz answers point at an option, and tasks can be checked", () => {
    for (const l of LESSONS)
      for (const s of l.steps) {
        if (s.quiz) {
          expect(s.quiz.answer).toBeGreaterThanOrEqual(0);
          expect(s.quiz.answer).toBeLessThan(s.quiz.options.length);
        }
        // A step that asks the learner to do something must be able to tell when it is done.
        if (s.task) expect(typeof s.done).toBe("function");
        if (s.showMe) expect(typeof s.done).toBe("function");
      }
  });
  it("has a glossary without duplicates", () => {
    expect(GLOSSARY.length).toBeGreaterThan(30);
    expect(new Set(GLOSSARY.map((g) => g.term)).size).toBe(GLOSSARY.length);
  });
});
