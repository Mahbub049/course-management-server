const BUBT_TIME_SLOTS = [
  {
    "id": "day_0815_0945",
    "start": "08:15 AM",
    "end": "09:45 AM",
    "label": "08:15 AM - 09:45 AM",
    "shift": "Day",
    "durationMinutes": 90,
    "order": 1,
    "sequenceOrder": 1,
    "nextSlotId": "day_0945_1115"
  },
  {
    "id": "day_0945_1115",
    "start": "09:45 AM",
    "end": "11:15 AM",
    "label": "09:45 AM - 11:15 AM",
    "shift": "Day",
    "durationMinutes": 90,
    "order": 2,
    "sequenceOrder": 2,
    "nextSlotId": "day_1115_1245"
  },
  {
    "id": "day_1115_1245",
    "start": "11:15 AM",
    "end": "12:45 PM",
    "label": "11:15 AM - 12:45 PM",
    "shift": "Day",
    "durationMinutes": 90,
    "order": 3,
    "sequenceOrder": 3,
    "nextSlotId": "day_1315_1445"
  },
  {
    "id": "day_1315_1445",
    "start": "01:15 PM",
    "end": "02:45 PM",
    "label": "01:15 PM - 02:45 PM",
    "shift": "Day",
    "durationMinutes": 90,
    "order": 4,
    "sequenceOrder": 4,
    "nextSlotId": "day_1445_1615"
  },
  {
    "id": "day_1445_1615",
    "start": "02:45 PM",
    "end": "04:15 PM",
    "label": "02:45 PM - 04:15 PM",
    "shift": "Day",
    "durationMinutes": 90,
    "order": 5,
    "sequenceOrder": 5,
    "nextSlotId": "day_1615_1745"
  },
  {
    "id": "day_1615_1745",
    "start": "04:15 PM",
    "end": "05:45 PM",
    "label": "04:15 PM - 05:45 PM",
    "shift": "Day",
    "durationMinutes": 90,
    "order": 6,
    "sequenceOrder": 6,
    "nextSlotId": ""
  },
  {
    "id": "eve_0800_0915",
    "start": "08:00 AM",
    "end": "09:15 AM",
    "label": "08:00 AM - 09:15 AM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 7,
    "sequenceOrder": 1,
    "nextSlotId": "eve_0915_1030"
  },
  {
    "id": "eve_0915_1030",
    "start": "09:15 AM",
    "end": "10:30 AM",
    "label": "09:15 AM - 10:30 AM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 8,
    "sequenceOrder": 2,
    "nextSlotId": "eve_1030_1145"
  },
  {
    "id": "eve_1030_1145",
    "start": "10:30 AM",
    "end": "11:45 AM",
    "label": "10:30 AM - 11:45 AM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 9,
    "sequenceOrder": 3,
    "nextSlotId": "eve_1145_1300"
  },
  {
    "id": "eve_1145_1300",
    "start": "11:45 AM",
    "end": "01:00 PM",
    "label": "11:45 AM - 01:00 PM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 10,
    "sequenceOrder": 4,
    "nextSlotId": ""
  },
  {
    "id": "eve_1515_1630",
    "start": "03:15 PM",
    "end": "04:30 PM",
    "label": "03:15 PM - 04:30 PM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 11,
    "sequenceOrder": 5,
    "nextSlotId": "eve_1630_1745"
  },
  {
    "id": "eve_1630_1745",
    "start": "04:30 PM",
    "end": "05:45 PM",
    "label": "04:30 PM - 05:45 PM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 12,
    "sequenceOrder": 6,
    "nextSlotId": "eve_1745_1900"
  },
  {
    "id": "eve_1745_1900",
    "start": "05:45 PM",
    "end": "07:00 PM",
    "label": "05:45 PM - 07:00 PM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 13,
    "sequenceOrder": 7,
    "nextSlotId": "eve_1900_2015"
  },
  {
    "id": "eve_1900_2015",
    "start": "07:00 PM",
    "end": "08:15 PM",
    "label": "07:00 PM - 08:15 PM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 14,
    "sequenceOrder": 8,
    "nextSlotId": "eve_2015_2130"
  },
  {
    "id": "eve_2015_2130",
    "start": "08:15 PM",
    "end": "09:30 PM",
    "label": "08:15 PM - 09:30 PM",
    "shift": "Evening",
    "durationMinutes": 75,
    "order": 15,
    "sequenceOrder": 9,
    "nextSlotId": ""
  }
];

const BUBT_ROOM_DIRECTORY = [
  {
    "buildingName": "Building-1",
    "roomNo": "1106",
    "roomTitle": "Engineering Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1107",
    "roomTitle": "Engineering Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1108",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1109",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1110",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1111",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1113",
    "roomTitle": "Common Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1114",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1203",
    "roomTitle": "Theory",
    "liftLevel": 1
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1302",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1401",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1401-B",
    "roomTitle": "Computing Lab",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1403",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1404",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1405",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1409",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1411",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1501",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1504-A",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1504-B",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1508",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1509",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1510",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1702",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1801",
    "roomTitle": "Hardware Lab",
    "liftLevel": 7
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1802",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1803",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1902",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Building-1",
    "roomNo": "1903",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2114",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2115",
    "roomTitle": "Hardware Lab",
    "liftLevel": 0
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2216",
    "roomTitle": "Hardware Lab",
    "liftLevel": 1
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2217",
    "roomTitle": "Computing Lab",
    "liftLevel": 1
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2218",
    "roomTitle": "Computing Lab",
    "liftLevel": 1
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2316",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2317",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2318",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2319",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2320",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2416",
    "roomTitle": "Computing Lab",
    "liftLevel": 3
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2417",
    "roomTitle": "Computing Lab",
    "liftLevel": 3
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2418",
    "roomTitle": "Computing Lab",
    "liftLevel": 3
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2419",
    "roomTitle": "Computing Lab",
    "liftLevel": 3
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2420",
    "roomTitle": "Computing Lab",
    "liftLevel": 3
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2517",
    "roomTitle": "Computing Lab",
    "liftLevel": 4
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2518",
    "roomTitle": "Computing Lab",
    "liftLevel": 4
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2616",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2617",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2618",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2619",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2620",
    "roomTitle": "Science Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2705",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2706",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2708",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2709",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2710",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2805",
    "roomTitle": "Hardware Lab",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2806",
    "roomTitle": "Hardware Lab",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2808",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2809",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2810",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2905",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2906",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2908",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2909",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Sujan Mahmud Building",
    "roomNo": "2910",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3401",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3505",
    "roomTitle": "Computing Lab",
    "liftLevel": 4
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3506",
    "roomTitle": "Computing Lab",
    "liftLevel": 4
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3507",
    "roomTitle": "Computing Lab",
    "liftLevel": 4
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3602",
    "roomTitle": "Theory",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3604",
    "roomTitle": "Theory",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3605",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3606",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3607",
    "roomTitle": "Hardware Lab",
    "liftLevel": 5
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3701",
    "roomTitle": "Hardware Lab",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3702",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3704",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3705",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3706",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3707",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3801",
    "roomTitle": "Engineering Lab",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3804",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3805",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3806",
    "roomTitle": "Engineering Lab",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3807",
    "roomTitle": "Engineering Lab",
    "liftLevel": 7
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3901",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3902",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3904",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3905",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3906",
    "roomTitle": "Drawing Lab",
    "liftLevel": 8
  },
  {
    "buildingName": "Martyr Tahmid Abdullah Building",
    "roomNo": "3907",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4301",
    "roomTitle": "Computing Lab",
    "liftLevel": 2
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4302",
    "roomTitle": "Theory",
    "liftLevel": 2
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4303",
    "roomTitle": "Computing Lab",
    "liftLevel": 2
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4404",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4405",
    "roomTitle": "Theory",
    "liftLevel": 3
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4501",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4504",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4505",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4506",
    "roomTitle": "Theory",
    "liftLevel": 4
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4601",
    "roomTitle": "Theory",
    "liftLevel": 5
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4604",
    "roomTitle": "Theory",
    "liftLevel": 5
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4605",
    "roomTitle": "Theory",
    "liftLevel": 5
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4701",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4703",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4704",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4705",
    "roomTitle": "Theory",
    "liftLevel": 6
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4801",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4804",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4805",
    "roomTitle": "Theory",
    "liftLevel": 7
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4901",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4904",
    "roomTitle": "Theory",
    "liftLevel": 8
  },
  {
    "buildingName": "Building-4",
    "roomNo": "4905",
    "roomTitle": "Theory",
    "liftLevel": 8
  }
];

module.exports = { BUBT_TIME_SLOTS, BUBT_ROOM_DIRECTORY };
