import java.util.HashSet;
import java.util.Set;
public final class Deduplicator {
    private final Set<String> seen = new HashSet<String>();
    public synchronized boolean claim(String tenant, String eventId) {
        if (tenant == null || tenant.isEmpty() || eventId == null || eventId.isEmpty()) {
            throw new IllegalArgumentException("tenant and eventId are required");
        }
        return seen.add(eventId);
    }
}
