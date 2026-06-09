package com.example.simple;

import java.util.Objects;

/**
 * A tiny greeter used as the simple-tier fixture for {@code lang-java}.
 *
 * Exercises: top-level class, fields (final & non-final), constructor,
 * method calls, a static method, and a leading Javadoc on both the
 * class and its members.
 */
public final class Greeter {
    public static final String DEFAULT_PREFIX = "Hello";

    private final String prefix;

    /** Default greeter using {@link #DEFAULT_PREFIX}. */
    public Greeter() {
        this(DEFAULT_PREFIX);
    }

    /** Greeter with a custom prefix. */
    public Greeter(String prefix) {
        this.prefix = Objects.requireNonNull(prefix, "prefix");
    }

    /**
     * Greet a name.
     *
     * @param name the name to greet
     * @return the greeting message
     */
    public String greet(String name) {
        Objects.requireNonNull(name, "name");
        return prefix + ", " + name + "!";
    }

    public static Greeter english() {
        return new Greeter("Hi");
    }
}
