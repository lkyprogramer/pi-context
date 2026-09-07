import java.util.List;
public final class VerificationStatus {
    public static final class Run {
        public final String revision;
        public final long observedAt;
        public final Boolean passed;
        public Run(String revision, long observedAt, Boolean passed) {
            this.revision=revision; this.observedAt=observedAt; this.passed=passed;
        }
    }
    public static boolean isCurrentSuccess(List<Run> runs, String revision) {
        for (Run r: runs) if (Boolean.TRUE.equals(r.passed)) return true;
        return false;
    }
}
