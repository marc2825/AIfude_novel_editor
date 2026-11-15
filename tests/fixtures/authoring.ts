import { emptyAuthoringProfile, type AuthoringProfile } from "../../src/domain/authoring-profile";
export function authoringFixture(): AuthoringProfile {
  return { ...emptyAuthoringProfile(), characters: [{ id: "40000000-0000-4000-8000-000000000001", revision: 1, updatedAt: "2026-10-27T00:00:00.000Z", name: "葵", aliases: ["あおい"], firstPerson: "僕", secondPerson: "君", addressTerms: "凪にはナギ", speechStyle: "短く静か", examples: "僕は待つよ。", avoidedExpressions: "だぜ", source: { chapterId: "10000000-0000-4000-8000-000000000003", chapterTitle: "第一章", contentRevision: 3, quote: "葵は待った。" } }], preservedTerms: ["葵"], preservationNote: "新しい人物を足さない" };
}
