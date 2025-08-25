from rest_framework import serializers
from .models import Turn, TurnURL


class TurnIceServerSerializer(serializers.ModelSerializer):
    """Serializer to convert Turn model to ICE server format for WebRTC"""
    
    urls = serializers.SerializerMethodField()
    username = serializers.CharField(source='login', read_only=True)
    credential = serializers.CharField(read_only=True)
    
    class Meta:
        model = Turn
        fields = ['urls', 'username', 'credential']
    
    def get_urls(self, obj):
        """Get all TurnURL objects for this Turn instance"""
        return [turn_url.url for turn_url in obj.turnurl_set.all()]
    
    def to_representation(self, instance):
        """Convert to ICE server format, omitting empty credentials"""
        representation = super().to_representation(instance)
        
        # Remove empty username/credential fields
        if not representation.get('username'):
            representation.pop('username', None)
        if not representation.get('credential'):
            representation.pop('credential', None)
            
        return representation


class IceServersSerializer(serializers.Serializer):
    """Serializer to format complete ICE servers configuration"""
    
    @staticmethod
    def get_ice_servers_config():
        """Generate complete ICE servers configuration including STUN and TURN servers"""
        ice_servers = []
        
        # Add default STUN servers
        stun_servers = [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302", 
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302",
            "stun:stun4.l.google.com:19302"
        ]
        
        for stun_url in stun_servers:
            ice_servers.append({"urls": stun_url})
        
        # Add TURN servers from database
        turn_servers = Turn.objects.all()
        turn_serializer = TurnIceServerSerializer(turn_servers, many=True)
        
        for turn_data in turn_serializer.data:
            if turn_data.get('urls'):  # Only add if URLs exist
                ice_servers.append(turn_data)
        
        return {
            "iceServers": ice_servers,
            "iceCandidatePoolSize": 10,
            "bundlePolicy": "max-bundle",
            "rtcpMuxPolicy": "require",
            "iceTransportPolicy": "all"
        }