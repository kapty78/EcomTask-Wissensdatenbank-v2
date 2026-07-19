/**
 * Integrations-Test: WDB-geformte Assistant-Nachrichten rendern durch die
 * geteilte SupportAI-Render-Engine (AssistantMessageBody → AgentTrace /
 * RichBlockRenderer). Sichert, dass WDBs Nachrichtenmodell (Teilmenge der
 * Block-Typen) korrekt vom geteilten Renderer dargestellt wird — die Grundlage
 * des Chat-Engine-Umbaus.
 *
 * ESM-/schwere Libs werden gemockt (react-markdown/remark-gfm = ESM, recharts =
 * gross und hier nicht benoetigt) — WDBs Wissens-Agent emittiert weder Chart-
 * noch Code-Highlighting-Bloecke.
 */
import { render, screen } from "@testing-library/react"
import {
  AssistantMessageBody,
  useTableSelection,
  useChoiceSelection,
  useFormState,
} from "@/components/agent-chat"
import type { ChatMessage } from "@/components/agent-chat"

// react-markdown (ESM) → Passthrough des Textinhalts
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: (props: { children?: React.ReactNode }) => props.children ?? null,
}))
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => {} }))
// recharts (schwer, ungenutzt in diesem Test) → leerer Stub
jest.mock("recharts", () => ({}))

function Harness({ message, isThinking = false }: { message: ChatMessage; isThinking?: boolean }) {
  const tableSelection = useTableSelection()
  const choiceSelection = useChoiceSelection()
  const formState = useFormState()
  return (
    <AssistantMessageBody
      message={message}
      tableSelection={tableSelection}
      choiceSelection={choiceSelection}
      formState={formState}
      isThinking={isThinking}
      isLatestMessage
      onSubmitMessage={async () => {}}
    />
  )
}

describe("AssistantMessageBody mit WDB-geformten Nachrichten", () => {
  it("rendert eine reine Tool-Aktivitaet als Trace mit Label", () => {
    const message: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "",
      toolActivities: [
        { id: "t1", label: "Wissensdatenbank durchsucht", status: "done" },
      ],
    }
    render(<Harness message={message} />)
    expect(screen.getByText("Wissensdatenbank durchsucht")).toBeInTheDocument()
  })

  it("rendert Text- und interactive_choices-Bloecke sichtbar (WDB-Teilmenge)", () => {
    const message: ChatMessage = {
      id: "m2",
      role: "assistant",
      content: "",
      richContent: {
        blocks: [
          { type: "text", text: "Hier ist deine Übersicht." },
          {
            type: "interactive_choices",
            prompt: "Welche Option?",
            options: [
              { id: "a", label: "Option A" },
              { id: "b", label: "Option B" },
            ],
          },
        ],
      },
    }
    render(<Harness message={message} />)
    // Text (durch gemocktes react-markdown als Passthrough)
    expect(screen.getByText("Hier ist deine Übersicht.")).toBeInTheDocument()
    // Interaktive Auswahl (bleibt sichtbar unter der Antwort)
    expect(screen.getByText("Option A")).toBeInTheDocument()
    expect(screen.getByText("Option B")).toBeInTheDocument()
  })

  it("partitioniert einen Tabellen-Block in die geteilte Details-Gruppe", () => {
    // Auswertungs-Bloecke (Tabelle) wandern laut geteilter AssistantMessageBody-
    // Logik in eine „Auswertungen & Details"-Gruppe. Das Routing ist das
    // integrationsrelevante Verhalten; die interne InteractiveTable-Struktur ist
    // Implementierungsdetail.
    const message: ChatMessage = {
      id: "m2b",
      role: "assistant",
      content: "",
      richContent: {
        blocks: [
          { type: "table", title: "Preise", columns: ["Artikel", "Preis"], rows: [["Kabel", "9,99 €"]] },
        ],
      },
    }
    render(<Harness message={message} />)
    expect(screen.getByText(/Auswertungen/)).toBeInTheDocument()
  })

  it("rendert eine reine Text-Antwort (kein Rich-Content)", () => {
    const message: ChatMessage = {
      id: "m3",
      role: "assistant",
      content: "Einfache Antwort ohne Bloecke.",
    }
    render(<Harness message={message} />)
    expect(screen.getByText("Einfache Antwort ohne Bloecke.")).toBeInTheDocument()
  })
})
