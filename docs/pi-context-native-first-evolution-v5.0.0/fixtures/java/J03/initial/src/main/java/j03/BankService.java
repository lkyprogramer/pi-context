package j03;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BankService {
    private final JdbcTemplate jdbc;

    public BankService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // BUG: this.debit() is self-invocation; @Transactional on debit() does not apply.
    public void transfer(int amount, boolean failAfterDebit) {
        debit(amount);
        if (failAfterDebit) throw new IllegalStateException("boom");
        credit(amount);
    }

    @Transactional
    public void debit(int amount) {
        jdbc.update("UPDATE accounts SET balance = balance - ?", amount);
        jdbc.update("INSERT INTO journal(amount) VALUES (?)", amount);
    }

    @Transactional
    public void credit(int amount) {
        jdbc.update("UPDATE accounts SET balance = balance + ?", 0);
    }
}
