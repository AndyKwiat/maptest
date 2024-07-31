
# Blockface algorithm
create map of nodes to segments for traversal later
get list of closest Segments


foreach segment that is matched to a meter
- check if blockface-road exists containing that segment
- if it doesn't exist create
	- navigate until intersection or road name change or curve??

- put segments into map, that maps segments to blockface-roads

foreach meter-segment pair
- check if blockface exsits: blockface is blockface-road + even/odd
- create if it doesn't exist:
	- determine if it's clockwise or anti-clockwise from segment heading
	- blockface = blockface road (nodes in order) + clockwise/anti 
		- + name from meter + even/odd and direction of meters
- Draw blockfaces:
	- follow blockface-road offset clockwise or anti-clockwise - offset based on # of lanes
	- stop BLOCK_WIDTH before end of intersections

adjustments: 
offset, startPos, endPos

srugery: 
break at  certain segment

