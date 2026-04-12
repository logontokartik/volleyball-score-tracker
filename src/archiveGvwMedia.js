/**
 * GVW club media embedded in the archive UI.
 * Past-tournament winner photos are taken from the club Google Sites “Past Tournaments” page
 * (top-to-bottom section order on that page = this array order).
 */

/** Must match `tournamentNames` keys in archiveData.json; order matches site sections newest → oldest. */
const PAST_TOURNAMENTS_WINNER_KEYS = [
  'Summer/Fall 2024',
  'Winter/Spring 2024',
  'Summer 2023',
  'Winter 2023',
  'Summer 2022',
  'Winter 2022',
  'Summer 2021',
  'Winter 2021',
  'Summer 2020',
  'Winter 2020',
  'Summer 2019',
  'Winter 2019',
  'Summer 2018',
  'Winter 2018',
  'Summer 2017',
];

/** Image URLs as embedded on sites.google.com/view/gvwvolleyball/past-tournaments (one per section). */
const PAST_TOURNAMENTS_WINNER_URLS_RAW = [
  'https://lh3.googleusercontent.com/sitesv/APaQ0STkOg8ywqJ-P_I2ZUpGPaP0HL-yQpT-vpeUgqBMd-HOl52ezhMXGl0CbZIufD24KA7gV0oFvgze3-Ia0kNFPH6Kxj6O4OVHz-Ewj2VJ6rYqLLMAil1FaQ6kh157umKnPrv5JrdejD0Xg9ZP2BBLWrlXjveODPEHMcediu36YWHt_VqBWvLVZ_Vh7M9VU2_QQ0j40jEYCXHq5y2pjgZHvzV7e-UR8q04hvWD=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0STBJhBwFp3LefviaURjDCPWH9ILyLYPcQzLid5iU7g8Lt0asxyLETx3pzfT9U3CP7NnNaPnRGXPWiVeZVGMRraBVEUPG6K9ROOL_tQNHQzjOwdsUQek6UUYwNv64O6sYeFZtMchyrCYPPzSFtG0PRGH3wpYv4qsnq6zazOgKr7xwDw4A35KT8s8BcU=w16383',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SQv_rFfFe02ZQq5_9wGlU32e6JexZ6fwkaLTj9r98jshtu2rfXVF3ePBgrVdt0er3qZT3JyfexdXSOQE5ArNqaW6_hOWeGv0450jRnpBxEVmzARW_06IwAZR5GmpCNFanVF3zKPNHJqZE-83Ep16i6ZNiD-d7E-x2mCfXsWgSebM91oo4vvKY0K6SEVD-54sW-Urd04789_nYeBmhDG1USJyi4tpmJAsKfA=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SQv8Vi5s1n_NS1nWbzLWG_l8nqhg35-5YlPzYfeKAQ34Vuy-kiMopTlLxppx0QvoE0zGorPZyVuuJlQPM8SCRu0QeQftuQKrnfk6Ctv9lENLgTkCVqVFnCUYje0OCmIYWoPTbn-2NuYBE71Y3n1MslpxRQdZc-HmxK78RSxRTjHtP1mBV4xmHUS6CpxkqlyWquaydGkqeUgpuC3nJl6stBQAsE4u_X2q5Mm=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SRCB0FGlPAAVnGj7gJRELCnC3Xs-ofYmsa6NWtkEGzGqoDqBH_b7k7o1RwIBTKT34r1WYw3Q_fCtyhA2F07PHKoBuDc3HrlYOpmlwC_tEQ5Lkax_MoGRgYLXb-NOiVxD-LLhUxpud-cPhGnBEtCUKz2s51kaeeEARjxf-xeW_1n1g6MgdBRkzjGPPqxVm-KURrpQ_eqbgy3ZWHvkCOO4BuQ891qj9J1xqrw=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SQdU0kdbMvJgAQHBwmiyC8CToEvkLT_wsNlvFtvjZN9GiYFloYD64PSPDxzNPMefhKAbifw0CCx9VLIKG_x2uza9w79UndqWeXnmyhBzfsZuadjORP16Xi4Jjx9OUB_DjhmLgH1t9BgN4vRgtEm6NCJOCz3u5d2-vJHr8eyBWX78Rca7a5hReL0WiffQPR3BVPUV0v_zxhWvZvyhLtg6YEZErHWOJaB9Wv368o=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SQlBXP3Mq_z5q1ZSJCuVXqRMf2eMd49YrnfeaLUqFxyXMfV4myVn2sQennyIP2GhsYUAUK53tyhH13ZZ1oCsjIg-6wOf3m10FdknmkhzfXGcGZltFjbfQ5VGJ2VowKFaRtR3ctnd0V_Wl9uOypubt5s95_yLxkrKBsU1QQhNAWRVixtbPAkMMQeQwqaweUIPkbZEPC4aunRLZtJ5tqaIGHJJsRe4p5S0rKm=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0STe1oYzs9b8bLxM07b4T-FPInTZlnpNUSiym6PE5bB_79dub_Q0cFs9U-lyT-0amypkvhn3rcUNrBz3qwucEb2Rd57ahhDsmgVnGJc-DGwNwrrL7UwZU_DSmzjSAC4smX-Z153d_QEjMTEMJeuJfGuL6rFBhMdUSQolDU-0N8qvlTXZdhoBSnMIUACvk8AmHe4vrw1vqmBRvWW-78ZZkkEwoPhzcwCA74VVRCw=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SRXyyt3Xz4rNTgJC9aTDpGjJudC-Neeq0qzKauWJxf94PF0wQ-Wz9P2iSNojnY0TG6N5OYRVzuEbWbvojLeBsKj668R26GyLNwDUttWkJV7e1_um3A3vuXtDgGvbZIaB3-0_nT2l-pWV1iEeEaSow1LhvdYoKiQeZoijWrUWkZBYLfcdVZPrH17iCu2856grAiUyWrv_kQdiCKpYojJcsrxc1bDeuba27SP=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SQla_MyzgnNGgmyaI3wJQgExRK8GeEHymOA6WZ4H1X8schulBOVfzrPImmnvDoo2lR4N_6osctqGZ4B-Y3i-o12ifwUG98-_Q8bfncKgjNeVGSEIfo16qMF6GwrgPS-wGuEmculyvxsyzWz2zOZW00Gtz0uK2w_FdAWjM6zAEOWIziLg2axSBJUwYtcD9MVYXKhlqU176GHUSD9BL7VjlL2TEPDKVmcReS_udI=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SS1-vTpghWBeFeOqPEknp3VlCNLnWNaY5iLj6AjAgwe8pmgxsaBwOcsKbc68Khu5y9kgvERXgcZMAB_B7tTm2kIqMuynOAGsYwxGfA03FoJfbnFZSHprvdKMuD9bYj7Dtjhgj6hfLQosCHNt67AebCwi2-pqKYbLKF3XFYo-KV-iIsy4F4FKT3iwRk7iN6gkQcpecog0Cao78p_vysDl4yoIwSXJu6Nsr7C4Mw=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0ST4oBl9LENP_FOUOoTk9nYOJ2AlW07R-RtQ4lW3zUpfEBODaqG5kr2djEbck2ZWt0yNdBV-3sja2UVP2O66x_qoVDLS261mcAGJLYvHS8sBYezqwNnryjnJFVoRoTp37Z1_ChD-bbM5_uzdm599lL0XtJ1kgi4YB3kAjM1lx4iChFAxTxfN9AC3PmSkXVcmE7vQPrRy00USmgfhQjZgbFvRZQt0VhFvzqaX=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SS9px18JF4N4AIcsZ-nlzwFwRjzu--oCQu44hxXUW3Jf143YupV9iugKa6kgwrMoMqQyNSbUD8IBg5_q1SRAQ9Eyt-_IlsMmK7R6SMGNVZhYHOJPg4LRAFxhm0F_ol321wVo_fzISMwVxmhFuqASud5tlK7S_ULipUYC_P1VmJxwSO1sffxjrkYMNmkmdVvlv9elas_1hDNqSoy5P42pW3b1TDJ6oPHuaAb=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0STSdRQzIEzyt8w5Tg9lyCoU88oI_MlvubXx65nSfUKsZlwlLrt3ZMNN7LtozH61rWNFaqgjGn59EIKUseFMKndWDHzuLrPfSwx-vK7-6ZEf-yKaMqaZ5AUjmCr2ZYgEDIAUi6BpvbdDOe1ysA1A3XqHTwskKrMXfioTw5tO8LBbAvG45WFv75rNK7gyojTneYbgNAytlk5Pp27xxqGFZ8pmKICEzUx8EjK0nps=w1280',
  'https://lh3.googleusercontent.com/sitesv/APaQ0SRV5rDYlsDOLINEkBmZa-D2XMevQwGgUxGhCX67lpp1aSayRACxp8PXpPksoao6ec6gZtjZp0zx1TpGUBGTOF59pm4kvh1ow6BwPk3MmXr0lkUjRNIlG3a_Fq7NVv0HBaApUiRx5a45pAHFubVCiOoY84MgqseITFV5QS-KK4XV3oN1gqM9F2wILyqqeVO1rW6daKggSl8S8E7o5-OBWYDUFgl-zcM5ZMiDED0=w1280',
];

export const PAST_TOURNAMENTS_WINNER_PHOTO_URLS = PAST_TOURNAMENTS_WINNER_URLS_RAW.map((u) =>
  u.replace(/=w16383$/, '=w1280')
);

/** Galleries on the Photos & video tab. */
export const GVW_MEDIA_GALLERIES = [
  {
    id: 'past-tournaments-winners',
    title: 'Past tournaments — winner photos',
    caption:
      'Same images as the GVW Past Tournaments page (Summer 2024 through Summer 2017), shown here in one gallery.',
    images: PAST_TOURNAMENTS_WINNER_PHOTO_URLS,
    /** Labels for captions under each thumbnail (same order as images). */
    labels: PAST_TOURNAMENTS_WINNER_KEYS,
  },
];

/**
 * Winner photo strips on the champions tab (one hero image per season from Past Tournaments).
 * `runnersUp` left empty — the site pairs winner/runner text under one photo per season.
 */
export const CHAMPION_PHOTOS_BY_TOURNAMENT = Object.fromEntries(
  PAST_TOURNAMENTS_WINNER_KEYS.map((key, i) => [
    key,
    {
      winners: [PAST_TOURNAMENTS_WINNER_PHOTO_URLS[i]],
      runnersUp: [],
    },
  ])
);

/**
 * Optional embedded clip: set to a Google Drive preview URL (`…/file/d/FILE_ID/preview`) when available.
 * Stays in-app (iframe); leave null to hide the video block.
 */
export const GVW_EMBEDDED_VIDEO_IFRAME_SRC = null;
