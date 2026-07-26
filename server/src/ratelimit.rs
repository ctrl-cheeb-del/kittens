//! Per-IP token bucket.
//!
//! The API is deliberately keyless, so the only thing standing between it and
//! someone's retry loop is this. Limits are applied per *request* rather than
//! per connection — HTTP/2 multiplexes and HTTP/1.1 keeps alive, so a
//! per-connection limit would be trivially bypassed by reusing one socket.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct Limits {
    /// Sustained requests per second.
    pub rate: f64,
    /// Bucket depth: how much burst is tolerated before throttling.
    pub burst: f64,
}

impl Default for Limits {
    fn default() -> Self {
        // Generous for a human clicking around or a CI job, restrictive enough
        // that a tight scraping loop gets told to slow down.
        Limits {
            rate: 5.0,
            burst: 60.0,
        }
    }
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateLimiter {
    limits: Limits,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
    /// Entries idle longer than this are dropped during pruning.
    idle_ttl: Duration,
}

impl RateLimiter {
    pub fn new(limits: Limits) -> RateLimiter {
        RateLimiter {
            limits,
            buckets: Mutex::new(HashMap::new()),
            idle_ttl: Duration::from_secs(600),
        }
    }

    /// Returns true if the request may proceed.
    pub fn allow(&self, ip: IpAddr) -> bool {
        self.allow_at(ip, Instant::now())
    }

    fn allow_at(&self, ip: IpAddr, now: Instant) -> bool {
        let mut buckets = match self.buckets.lock() {
            Ok(g) => g,
            // A poisoned lock means another thread panicked while holding it.
            // Failing open is the right call: dropping traffic because of an
            // unrelated bug would turn a small fault into an outage.
            Err(poisoned) => poisoned.into_inner(),
        };

        // Amortised cleanup. Without it, a scan of the IPv6 space would grow
        // this map without bound.
        if buckets.len() > 10_000 {
            let ttl = self.idle_ttl;
            buckets.retain(|_, b| now.duration_since(b.last) < ttl);
        }

        let bucket = buckets.entry(ip).or_insert(Bucket {
            tokens: self.limits.burst,
            last: now,
        });

        let elapsed = now.duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.limits.rate).min(self.limits.burst);
        bucket.last = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    #[cfg(test)]
    fn tracked(&self) -> usize {
        self.buckets.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(n: u8) -> IpAddr {
        IpAddr::from([203, 0, 113, n])
    }

    #[test]
    fn burst_is_allowed_then_throttled() {
        let rl = RateLimiter::new(Limits {
            rate: 1.0,
            burst: 5.0,
        });
        let t = Instant::now();
        for i in 0..5 {
            assert!(rl.allow_at(ip(1), t), "request {i} within burst should pass");
        }
        assert!(!rl.allow_at(ip(1), t), "6th request should be throttled");
    }

    #[test]
    fn tokens_refill_over_time() {
        let rl = RateLimiter::new(Limits {
            rate: 2.0,
            burst: 2.0,
        });
        let t0 = Instant::now();
        assert!(rl.allow_at(ip(1), t0));
        assert!(rl.allow_at(ip(1), t0));
        assert!(!rl.allow_at(ip(1), t0));

        // One second later, 2 tokens have been restored.
        let t1 = t0 + Duration::from_secs(1);
        assert!(rl.allow_at(ip(1), t1));
        assert!(rl.allow_at(ip(1), t1));
        assert!(!rl.allow_at(ip(1), t1));
    }

    #[test]
    fn refill_never_exceeds_burst() {
        let rl = RateLimiter::new(Limits {
            rate: 100.0,
            burst: 3.0,
        });
        let t0 = Instant::now();
        assert!(!rl.allow_at(ip(1), t0) || true); // prime the bucket
        // An hour of idling must not bank more than `burst` tokens.
        let t1 = t0 + Duration::from_secs(3600);
        let mut allowed = 0;
        for _ in 0..50 {
            if rl.allow_at(ip(1), t1) {
                allowed += 1;
            }
        }
        assert_eq!(allowed, 3, "capped at burst depth");
    }

    #[test]
    fn limits_are_per_ip() {
        let rl = RateLimiter::new(Limits {
            rate: 0.0,
            burst: 1.0,
        });
        let t = Instant::now();
        assert!(rl.allow_at(ip(1), t));
        assert!(!rl.allow_at(ip(1), t), "first IP exhausted");
        // A different visitor is unaffected.
        assert!(rl.allow_at(ip(2), t), "second IP has its own bucket");
    }

    #[test]
    fn idle_entries_are_pruned() {
        let rl = RateLimiter::new(Limits::default());
        let t0 = Instant::now();
        for n in 0..=255u8 {
            for a in 0..=40u8 {
                rl.allow_at(IpAddr::from([10, a, 0, n]), t0);
            }
        }
        assert!(rl.tracked() > 10_000);

        // Well past the TTL, the next call sweeps the stale entries.
        let t1 = t0 + Duration::from_secs(1200);
        rl.allow_at(ip(9), t1);
        assert!(
            rl.tracked() < 100,
            "stale buckets should be reclaimed, {} remain",
            rl.tracked()
        );
    }

    #[test]
    fn ipv6_is_tracked_separately() {
        let rl = RateLimiter::new(Limits {
            rate: 0.0,
            burst: 1.0,
        });
        let t = Instant::now();
        let v6: IpAddr = "2001:db8::1".parse().unwrap();
        assert!(rl.allow_at(v6, t));
        assert!(!rl.allow_at(v6, t));
        assert!(rl.allow_at(ip(1), t));
    }
}
