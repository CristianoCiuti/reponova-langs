/**
 * Tiny key→value cache with FNV-1a hashing and chained collisions.
 *
 * Public surface lives in `cache.h`; the implementation in `cache.c`
 * exercises typedefs, anonymous struct typedefs, enums, function
 * pointers as fields, macros, and a non-trivial include graph.
 */
#ifndef CACHE_H
#define CACHE_H

#include <stddef.h>
#include <stdint.h>

/** Maximum number of buckets a cache may have. */
#define CACHE_MAX_BUCKETS 4096

/** Hashing seed used by FNV-1a (do not reuse outside this library). */
#define CACHE_HASH_SEED 0x811C9DC5u

/** Compute the larger of two `size_t` values. */
#define CACHE_MAX(a, b) ((a) > (b) ? (a) : (b))

typedef enum {
  CACHE_OK = 0,
  CACHE_ERR_NOMEM = -1,
  CACHE_ERR_NOTFOUND = -2,
} cache_status_t;

typedef struct cache cache_t;

typedef uint32_t (*cache_hasher_t)(const char* key, size_t len);

/** Create a new cache with the given bucket count and hasher. */
cache_t* cache_new(size_t buckets, cache_hasher_t hasher);

/** Free a cache and all internal storage. */
void cache_free(cache_t* c);

/** Insert or replace a key/value pair. */
cache_status_t cache_put(cache_t* c, const char* key, const void* value, size_t value_len);

/** Look up a key. On miss returns CACHE_ERR_NOTFOUND. */
cache_status_t cache_get(const cache_t* c, const char* key, const void** out_value, size_t* out_len);

#endif /* CACHE_H */
