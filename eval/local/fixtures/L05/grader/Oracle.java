import java.util.ArrayList;
import java.util.List;
public final class Oracle {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        List<TenantRepository.Row> rows = new ArrayList<TenantRepository.Row>();
        rows.add(new TenantRepository.Row("B", "same", "foreign"));
        rows.add(new TenantRepository.Row("A", "same", "own"));
        rows.add(new TenantRepository.Row("A", "other", "own-2"));
        TenantRepository r = new TenantRepository(rows);
        check(r.findAll("A").size()==2, "list query leaked foreign tenant");
        check("own".equals(r.findOne("A", "same").value), "id query ignored tenant");
        check(r.findOne("missing", "same")==null, "unknown tenant must see no row");
        r.findAll("A").clear();
        check(r.findAll("A").size()==2, "returned list must not mutate repository");
        System.out.println("ORACLE_PASS:J02");
    }
}
