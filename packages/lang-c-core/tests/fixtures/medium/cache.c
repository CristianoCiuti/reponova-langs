/**
 * Implementation of the tiny key→value cache declared in cache.h.
 *
 * Demonstrates: static functions, typedef'd anonymous struct, function
 * pointers stored as struct fields, function-like macros, includes
 * with both angle-bracket and quoted forms.
 */
#include <stdlib.h>
#include <string.h>
#include "cache.h"

#define CHAIN_INITIAL_CAP 4

typedef struct entry {
  char* key;
  void* value;
  size_t value_len;
  struct entry* next;
} entry_t;

struct cache {
  size_t buckets;
  entry_t** table;
  cache_hasher_t hasher;
  size_t count;
};

/** Default FNV-1a 32-bit hasher used when callers pass NULL. */
static uint32_t default_fnv1a(const char* key, size_t len) {
  uint32_t h = CACHE_HASH_SEED;
  for (size_t i = 0; i < len; i++) {
    h ^= (uint32_t)(unsigned char)key[i];
    h *= 0x01000193u;
  }
  return h;
}

static size_t bucket_for(const cache_t* c, const char* key) {
  const cache_hasher_t hasher = c->hasher ? c->hasher : default_fnv1a;
  return (size_t)(hasher(key, strlen(key)) % c->buckets);
}

cache_t* cache_new(size_t buckets, cache_hasher_t hasher) {
  if (buckets == 0 || buckets > CACHE_MAX_BUCKETS) return NULL;
  cache_t* c = (cache_t*)calloc(1, sizeof(*c));
  if (!c) return NULL;
  c->table = (entry_t**)calloc(buckets, sizeof(entry_t*));
  if (!c->table) {
    free(c);
    return NULL;
  }
  c->buckets = buckets;
  c->hasher = hasher;
  return c;
}

static void entry_free(entry_t* e) {
  if (!e) return;
  free(e->key);
  free(e->value);
  free(e);
}

void cache_free(cache_t* c) {
  if (!c) return;
  for (size_t i = 0; i < c->buckets; i++) {
    entry_t* cur = c->table[i];
    while (cur) {
      entry_t* next = cur->next;
      entry_free(cur);
      cur = next;
    }
  }
  free(c->table);
  free(c);
}

cache_status_t cache_put(cache_t* c, const char* key, const void* value, size_t value_len) {
  if (!c || !key) return CACHE_ERR_NOTFOUND;
  size_t idx = bucket_for(c, key);
  entry_t* cur = c->table[idx];
  while (cur) {
    if (strcmp(cur->key, key) == 0) {
      void* nv = realloc(cur->value, CACHE_MAX(value_len, 1));
      if (!nv && value_len > 0) return CACHE_ERR_NOMEM;
      cur->value = nv;
      memcpy(cur->value, value, value_len);
      cur->value_len = value_len;
      return CACHE_OK;
    }
    cur = cur->next;
  }
  entry_t* e = (entry_t*)calloc(1, sizeof(*e));
  if (!e) return CACHE_ERR_NOMEM;
  e->key = strdup(key);
  e->value = malloc(CACHE_MAX(value_len, 1));
  if (!e->key || !e->value) {
    entry_free(e);
    return CACHE_ERR_NOMEM;
  }
  memcpy(e->value, value, value_len);
  e->value_len = value_len;
  e->next = c->table[idx];
  c->table[idx] = e;
  c->count++;
  return CACHE_OK;
}

cache_status_t cache_get(const cache_t* c, const char* key, const void** out_value, size_t* out_len) {
  if (!c || !key || !out_value) return CACHE_ERR_NOTFOUND;
  size_t idx = bucket_for(c, key);
  entry_t* cur = c->table[idx];
  while (cur) {
    if (strcmp(cur->key, key) == 0) {
      *out_value = cur->value;
      if (out_len) *out_len = cur->value_len;
      return CACHE_OK;
    }
    cur = cur->next;
  }
  return CACHE_ERR_NOTFOUND;
}
