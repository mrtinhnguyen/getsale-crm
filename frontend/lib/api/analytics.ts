import { apiClient } from './client';

export interface BdTeamWeekCell {
  new_chats: number;
  not_read: number;
  read_no_reply: number;
  replied: number;
  pct_not_read: number;
  pct_read_no_reply: number;
  pct_replied: number;
}

export interface BdTeamWeekAccount {
  bd_account_id: string;
  account_display_name: string;
}

export interface BdTeamWeekMatrixRow {
  bd_account_id: string;
  by_date: Record<string, BdTeamWeekCell>;
}

export interface BdTeamWeekBdWeekRow {
  bd_account_id: string;
  week: BdTeamWeekCell;
}

export interface BdTeamWeekResponse {
  week_start: string;
  days: string[];
  accounts: BdTeamWeekAccount[];
  matrix: BdTeamWeekMatrixRow[];
  day_totals: Record<string, BdTeamWeekCell>;
  bd_week: BdTeamWeekBdWeekRow[];
  week_grand: BdTeamWeekCell;
  data_available_from: string | null;
}

export async function fetchBdTeamWeek(weekStart: string): Promise<BdTeamWeekResponse> {
  const res = await apiClient.get<BdTeamWeekResponse>('/api/analytics/bd/team-week', {
    params: { week_start: weekStart },
  });
  return res.data;
}
