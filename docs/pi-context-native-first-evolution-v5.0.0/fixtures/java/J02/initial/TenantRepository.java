import java.util.ArrayList;
import java.util.List;
public final class TenantRepository {
    public static final class Row {
        public final String tenant, id, value;
        public Row(String tenant, String id, String value) {
            this.tenant=tenant; this.id=id; this.value=value;
        }
    }
    private final List<Row> rows;
    public TenantRepository(List<Row> rows) { this.rows = new ArrayList<Row>(rows); }
    public List<Row> findAll(String tenant) { return new ArrayList<Row>(rows); }
    public Row findOne(String tenant, String id) {
        for (Row row: rows) if (row.id.equals(id)) return row;
        return null;
    }
}
