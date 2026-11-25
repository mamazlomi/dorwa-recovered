// Shape of public.pharmacist_bank() rows (Dorva-only list of pharmacists).
export type BankRow = {
  id: string; full_name: string; council_no: string | null; resume: string | null; has_resume_text: boolean;
  profile: {
    degree?: string; specialty?: string; university?: string; grad_year?: string; years_total?: string; languages?: string;
    expertise?: string[]; areas?: Record<string, string>; work_history?: string; achievements?: string; other_degrees?: string; consent?: boolean;
  };
  pharmacy: { id: string; slug: string; name_fa: string; status: string };
  city: string | null; updated_at: string;
};
export type Bank = { total: number; consented: number; rows: BankRow[] };
