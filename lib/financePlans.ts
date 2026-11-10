// Messages d'erreur lisibles pour les tables des Finances (les placements ont été retirés de l'appli)

// Tables créées par le script supabase/finances_coherence.sql (les autres le sont par supabase/finance_coach.sql)
const COHERENCE_TABLES = ['statement_months', 'balance_links'];

// Message lisible quand une table n'existe pas encore dans Supabase
export function describeDbError(message: string) {
  if (/'auto' column|column .*auto/i.test(message)) {
    return "Il manque la colonne « auto » dans la table finance_lines : exécute le script supabase/finances_coherence.sql dans l'éditeur SQL de Supabase.";
  }
  const table = message.match(
    /(bank_transactions|category_rules|budgets|planned_expenses|finance_lines|custom_categories|removed_categories|category_groups|category_settings|statement_months|balance_links|month_budgets)/
  )?.[1];
  if (table && /(does not exist|schema cache|not find)/i.test(message)) {
    const script =
      table === 'month_budgets' ? 'supabase/month_budgets.sql' : COHERENCE_TABLES.includes(table) ? 'supabase/finances_coherence.sql' : 'supabase/finance_coach.sql';
    return `La table « ${table} » n'existe pas encore dans Supabase : exécute le script ${script} dans l'éditeur SQL.`;
  }
  // Sécurité au niveau des lignes activée sans règle d'accès : le bloc final du script ajoute ces règles
  const blocked = message.match(/row-level security policy for table "(\w+)"/)?.[1];
  if (blocked) {
    return `Supabase refuse l'écriture dans « ${blocked} » (sécurité RLS sans règle d'accès) : exécute le script supabase/finances_coherence.sql dans l'éditeur SQL.`;
  }
  return `Erreur : ${message}`;
}
