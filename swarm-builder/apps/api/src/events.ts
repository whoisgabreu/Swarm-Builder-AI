import type { BuildEvent, SequencedEvent } from "@swarm/protocol";

type Listener = (event: SequencedEvent) => void;

export class RunChannel {
  private seq = 0;
  private readonly listeners = new Set<Listener>();
  readonly events: SequencedEvent[] = [];

  emit(event: BuildEvent): SequencedEvent {
    const sequenced = { ...event, seq: ++this.seq } as SequencedEvent;
    this.events.push(sequenced);
    for (const listener of this.listeners) {
      try {
        listener(sequenced);
      } catch {
        // a broken client must never break the build
      }
    }
    return sequenced;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
