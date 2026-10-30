/* A thin door onto primer3's thermodynamic alignment, for WebAssembly.
   Everything here is argument shuffling; the computation is thal(). */
#include <string.h>
#include "thal.h"

/* The caller writes the two oligos here rather than into the heap, which thal
   allocates from while it runs. */
static char buf1[1024], buf2[1024];
__attribute__((export_name("p3_buf1"))) char *p3_buf1(void) { return buf1; }
__attribute__((export_name("p3_buf2"))) char *p3_buf2(void) { return buf2; }

static int ready = 0;
static double out_dg, out_dh, out_ds, out_temp;
static char out_msg[255];
/* The drawing primer3 makes of the structure it found, so the picture and the
   energy beside it come from the same place. */
static char out_struct[4096];

__attribute__((export_name("p3_init"))) int p3_init(void) {
  /* The parameter tables are default-initialised in thal_params.c, so there is
     nothing to load; this stays so the caller has one place to check. */
  ready = 1;
  return 0;
}

/* type: 1 any (dimer), 4 hairpin. Concentrations as primer3 takes them. */
__attribute__((export_name("p3_thal"))) int p3_thal(
    const char *s1, const char *s2, int type, double mv, double dv, double dntp,
    double dna_conc, double temp_c, int dimer) {
  thal_args a;
  thal_results r;
  set_thal_default_args(&a);
  a.type = (thal_alignment_type)type;
  a.mv = mv;
  a.dv = dv;
  a.dntp = dntp;
  a.dna_conc = dna_conc;
  a.temp = temp_c + 273.15;
  a.dimer = dimer;
  memset(&r, 0, sizeof(r));
  thal((const unsigned char *)s1, (const unsigned char *)s2, &a, THL_STRUCT, &r);
  out_dg = r.dg;
  out_dh = r.dh;
  out_ds = r.ds;
  out_temp = r.temp;
  strncpy(out_msg, r.msg, sizeof(out_msg) - 1);
  out_struct[0] = 0;
  if (r.sec_struct) strncpy(out_struct, r.sec_struct, sizeof(out_struct) - 1);
  return out_msg[0] ? 1 : 0;
}

__attribute__((export_name("p3_dg"))) double p3_dg(void) { return out_dg; }
__attribute__((export_name("p3_dh"))) double p3_dh(void) { return out_dh; }
__attribute__((export_name("p3_ds"))) double p3_ds(void) { return out_ds; }
__attribute__((export_name("p3_temp"))) double p3_temp(void) { return out_temp; }
__attribute__((export_name("p3_msg"))) const char *p3_msg(void) { return out_msg; }
__attribute__((export_name("p3_struct"))) const char *p3_struct(void) { return out_struct; }
