export type Party = 'owner' | 'agent';
export type State = 'started' | 'done' | 'refused' | 'failed';

export interface DemoEvent {
  id: string;
  party: Party;
  title: string;
  state: State;
  sub?: string;
  amount?: string;
  hash?: string;
  rule?: string;
}
