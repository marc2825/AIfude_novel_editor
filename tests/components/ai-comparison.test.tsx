import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getAiModelsForProvider } from "../../src/domain/ai-models";
import { ComparisonControls } from "../../src/features/ai-edit/ComparisonControls";
import { AiConsentDisclosure } from "../../src/features/ai-edit/AiConsentDisclosure";
import type { PublicAiRuntime } from "../../src/features/ai-edit/consent";
import type { AiEditCommandInput } from "../../src/features/ai-edit/machine";
import { MOCK_AI_RUNTIME, LOCAL_AI_RUNTIME } from "../fixtures/ai-runtime";

const gemini: PublicAiRuntime = { available: true, providerId: "gemini", defaultModelId: "gemini-default", models: getAiModelsForProvider("gemini"), externalDataTransfer: true };
const claude: PublicAiRuntime = { ...gemini, providerId: "claude", defaultModelId: "claude-default", models: getAiModelsForProvider("claude") };
const runtime: PublicAiRuntime = { ...MOCK_AI_RUNTIME, comparisonProviders: [MOCK_AI_RUNTIME, LOCAL_AI_RUNTIME, claude, gemini] };
const input: AiEditCommandInput = { instruction: "自然に", presetId: null, candidateCount: 2 };
describe("AI comparison controls", () => {
  it("discloses only prompt data for external insertion", () => {
    render(<AiConsentDisclosure runtime={gemini} promptOnly consent={null} commonPromptIncluded={false} manualStyleIncluded={false} modelPreference="automatic" onChange={async () => ({ ok: true })} />);
    expect(screen.getByText(/入力した文章のプロンプトだけ/u)).toBeInTheDocument();
    expect(screen.queryByText("選択した原稿本文")).not.toBeInTheDocument();
    expect(screen.queryByText(/選択範囲の直前・直後の本文/u)).not.toBeInTheDocument();
  });
  it("keeps paid API targets OFF until settings opt-in and clears consent when targets change", () => {
    const onChange = vi.fn();
    const view = render(<ComparisonControls runtime={runtime} input={input} onChange={onChange} disabled={false} />);
    expect(screen.getByRole("checkbox", { name: /Gemini API/u })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Claudeサブスク/u }));
    expect(onChange).toHaveBeenLastCalledWith({ ...input, compareProviderIds: ["claude"], compareConsent: false });
    view.rerender(<ComparisonControls runtime={{ ...runtime, paidApiEnabled: true }} input={{ ...input, compareProviderIds: ["mock", "claude"], compareConsent: true }} onChange={onChange} disabled={false} />);
    expect(screen.getByRole("checkbox", { name: /Gemini API/u })).toBeEnabled(); fireEvent.click(screen.getByRole("checkbox", { name: /Gemini API/u }));
    expect(onChange).toHaveBeenLastCalledWith({ ...input, compareProviderIds: ["mock", "claude", "gemini"], compareConsent: false });
    view.rerender(<ComparisonControls runtime={{ ...runtime, paidApiEnabled: true }} input={{ ...input, compareProviderIds: ["mock", "claude", "gemini"] }} onChange={onChange} disabled={false} />);
    expect(screen.getByRole("checkbox", { name: /ローカルLLM/u })).toBeDisabled();
  });
});
