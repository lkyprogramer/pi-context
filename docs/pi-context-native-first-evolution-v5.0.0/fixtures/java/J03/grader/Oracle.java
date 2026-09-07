package j03;

import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);
        BankService svc = ctx.getBean(BankService.class);
        JdbcTemplate jdbc = ctx.getBean(JdbcTemplate.class);
        svc.transfer(1, false);
        Integer okBalance = jdbc.queryForObject("SELECT balance FROM accounts WHERE id=1", Integer.class);
        Integer okJournal = jdbc.queryForObject("SELECT COUNT(*) FROM journal", Integer.class);
        check(okBalance != null && okBalance == 99, "success must debit accounts");
        check(okJournal != null && okJournal >= 1, "success must write journal");
        ctx.close();

        AnnotationConfigApplicationContext failCtx = new AnnotationConfigApplicationContext(AppConfig.class);
        BankService failSvc = failCtx.getBean(BankService.class);
        JdbcTemplate failJdbc = failCtx.getBean(JdbcTemplate.class);
        boolean threw = false;
        try {
            failSvc.transfer(5, true);
        } catch (IllegalStateException e) {
            threw = true;
        }
        check(threw, "failure must surface");
        Integer failBalance = failJdbc.queryForObject("SELECT balance FROM accounts WHERE id=1", Integer.class);
        Integer failJournal = failJdbc.queryForObject("SELECT COUNT(*) FROM journal", Integer.class);
        check(failBalance != null && failBalance == 100, "failed transfer must not change accounts");
        check(failJournal != null && failJournal == 0, "failed transfer must not write journal");
        failCtx.close();
        System.out.println("ORACLE_PASS:J03");
    }
}
