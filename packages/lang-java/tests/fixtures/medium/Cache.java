package com.example.medium;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import static java.util.Collections.emptyMap;

/**
 * A generic key-value cache hierarchy.
 *
 * Mirrors the Python medium fixture: showcases generics, inner types,
 * a sealed-style ABC contract via {@link Cache}, a default-method
 * interface, a record-style value, an enum with behaviour, and a
 * nested annotation interface.
 */
public final class CacheModule {

    private CacheModule() {}

    /** Hit / miss counters for diagnostics. */
    public static record Stats(long hits, long misses) {
        public long total() {
            return hits + misses;
        }
    }

    /** Strategy used by the loader to short-circuit on misses. */
    public enum MissPolicy {
        RETURN_NULL,
        THROW,
        LOAD_DEFAULT;

        public boolean isLoading() {
            return this == LOAD_DEFAULT;
        }
    }

    /** Marks a cache implementation as thread-safe (documentation only). */
    public @interface ThreadSafe {
        String reason() default "";
    }

    /**
     * Functional contract: load a value for a missing key.
     *
     * @param <K> key type
     * @param <V> value type
     */
    public interface Loader<K, V> extends Function<K, V> {
        /** Lifts a method reference into a {@link Loader}. */
        static <K, V> Loader<K, V> of(Function<K, V> fn) {
            return fn::apply;
        }
    }

    /**
     * Generic cache contract. Subclasses choose the storage strategy.
     *
     * @param <K> key type
     * @param <V> value type
     */
    public abstract static class Cache<K, V> implements AutoCloseable {
        protected final String name;

        protected Cache(String name) {
            this.name = Objects.requireNonNull(name, "name");
        }

        public abstract Optional<V> get(K key);
        public abstract void put(K key, V value);
        public abstract Stats stats();

        public V getOrLoad(K key, Loader<K, V> loader) {
            Optional<V> existing = get(key);
            if (existing.isPresent()) return existing.get();
            V loaded = loader.apply(key);
            put(key, loaded);
            return loaded;
        }

        @Override
        public void close() {}
    }

    @ThreadSafe(reason = "wraps ConcurrentHashMap")
    public static final class InMemoryCache<K, V> extends Cache<K, V> {
        private final Map<K, V> storage = new ConcurrentHashMap<>();
        private long hits = 0;
        private long misses = 0;

        public InMemoryCache(String name) {
            super(name);
        }

        @Override
        public Optional<V> get(K key) {
            V v = storage.get(key);
            if (v == null) {
                misses++;
                return Optional.empty();
            }
            hits++;
            return Optional.of(v);
        }

        @Override
        public void put(K key, V value) {
            storage.put(key, value);
        }

        @Override
        public Stats stats() {
            return new Stats(hits, misses);
        }
    }

    public static final class NoOpCache<K, V> extends Cache<K, V> {
        public NoOpCache(String name) { super(name); }

        @Override public Optional<V> get(K key) { return Optional.empty(); }
        @Override public void put(K key, V value) {}
        @Override public Stats stats() { return new Stats(0, 0); }
    }

    /** Factory: returns a cache populated from an immutable bootstrap map. */
    public static <K, V> Cache<K, V> bootstrapped(String name, Map<K, V> seed) {
        InMemoryCache<K, V> cache = new InMemoryCache<>(name);
        Map<K, V> effective = seed == null ? CacheModule.<K, V>emptySeed() : new HashMap<>(seed);
        for (Map.Entry<K, V> entry : effective.entrySet()) {
            cache.put(entry.getKey(), entry.getValue());
        }
        return cache;
    }

    private static <K, V> Map<K, V> emptySeed() {
        // Exercises the static import.
        return emptyMap();
    }
}
