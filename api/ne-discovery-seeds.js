/**
 * Seed URLs for weekly New England volleyball feed discovery.
 *
 * These are PUBLIC pages we are allowed to fetch (robots/terms permitting).
 * The discover job looks for .ics / Google Calendar iCal links on/near them.
 * It does NOT scrape Facebook, Meetup, Instagram, or Active.com HTML for events.
 *
 * Expand this list over time — towns, Ys, universities, clubs that publish calendars.
 */

module.exports = [
  // Massachusetts — universities / fitrec (often publish hours pages; ics when linked)
  {
    name: 'BU FitRec hours',
    state: 'MA',
    url: 'https://www.bu.edu/fitrec/hours/',
  },
  {
    name: 'MIT Open Rec',
    state: 'MA',
    url: 'https://web.mit.edu/athletics/www/recreation/',
  },
  {
    name: 'Harvard Rec calendars hub',
    state: 'MA',
    url: 'https://recreation.gocrimson.com/',
  },
  {
    name: 'Northeastern Recreation',
    state: 'MA',
    url: 'https://recreation.northeastern.edu/',
  },
  {
    name: 'UMass Amherst Recreation',
    state: 'MA',
    url: 'https://www.umass.edu/recreation/',
  },
  {
    name: 'Boston United Open Gym',
    state: 'MA',
    url: 'https://bostonuvc.com/club/opengym',
  },
  {
    name: 'Norwood Rec activities',
    state: 'MA',
    url: 'https://norwoodma.myrec.com/info/activities/index.aspx',
  },
  {
    name: 'Longmeadow Co-Ed Volleyball',
    state: 'MA',
    url: 'https://www.longmeadowma.gov/381/Co-Ed-Volleyball',
  },

  // Connecticut
  {
    name: 'Yale Recreation',
    state: 'CT',
    url: 'https://recreation.yale.edu/',
  },
  {
    name: 'UConn Recreation',
    state: 'CT',
    url: 'https://recreation.uconn.edu/',
  },

  // Rhode Island
  {
    name: 'Brown Recreation',
    state: 'RI',
    url: 'https://www.brown.edu/athletics/recreation',
  },
  {
    name: 'URI Recreation',
    state: 'RI',
    url: 'https://web.uri.edu/recreation/',
  },

  // New Hampshire
  {
    name: 'UNH Campus Recreation',
    state: 'NH',
    url: 'https://www.unh.edu/campusrecreation/',
  },
  {
    name: 'Dartmouth Outdoor / Rec',
    state: 'NH',
    url: 'https://outdoors.dartmouth.edu/',
  },

  // Vermont
  {
    name: 'UVM Recreation',
    state: 'VT',
    url: 'https://www.uvm.edu/campusrec',
  },

  // Maine
  {
    name: 'UMaine Campus Recreation',
    state: 'ME',
    url: 'https://umaine.edu/campusrecreation/',
  },
];
